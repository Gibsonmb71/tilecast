package httpapi

import (
	"fmt"
	"strings"
)

// The telemetry tables are wide, and everything done to them is mechanical: the
// snapshot takes the latest value of every gauge, the rollup combines every
// counter with whatever the bucket already holds, and the report reads them
// back. Describing each column once — its name, where the value comes from in a
// sample, and where it goes in a response — generates all three.
//
// Written out by hand, one new measurement meant editing a column list, a
// placeholder list, an update clause, an argument list, a SELECT list, and a
// scan list in agreement. Six places, where a single disagreement silently
// writes one measurement into another's column or reads it back as another's
// value. Here a column exists once and cannot be half-added.

// telemetryMerge says how a rollup column combines a new sample with the value
// already in the bucket.
type telemetryMerge int

const (
	// Additive counters: the bucket holds the total for its window.
	mergeSum telemetryMerge = iota
	// Averages, recomputed as a running mean weighted by sample count so a
	// bucket receiving ten samples is not just the last one.
	mergeMean
	// Peaks, and percentiles. Percentiles cannot be merged without the samples
	// that produced them, so the bucket keeps the worst reported figure rather
	// than inventing a blend of two distributions.
	mergeMax
	// Per-key numeric addition over a bounded JSON object.
	mergeJSONBAdd
)

type telemetryGaugeColumn struct {
	name  string
	value func(telemetrySampleInput) any
	scan  func(*telemetrySnapshot) any
}

type telemetryRollupColumn struct {
	name  string
	merge telemetryMerge
	value func(telemetrySampleInput) any
	scan  func(*telemetryRollup) any
}

// telemetryGaugeColumns is the snapshot: the latest reported value of each
// gauge, one row per screen. The order here is the order of the generated
// statements and is otherwise free.
var telemetryGaugeColumns = []telemetryGaugeColumn{
	{"observed_at",
		func(in telemetrySampleInput) any { return in.ObservedAt },
		func(out *telemetrySnapshot) any { return &out.ObservedAt }},

	{"current_item_id",
		func(in telemetrySampleInput) any { return in.CurrentItemID },
		func(out *telemetrySnapshot) any { return &out.CurrentItemID }},
	{"item_started_at",
		func(in telemetrySampleInput) any { return in.ItemStartedAt },
		func(out *telemetrySnapshot) any { return &out.ItemStartedAt }},
	{"last_meaningful_progress_at",
		func(in telemetrySampleInput) any { return in.LastMeaningfulProgressAt },
		func(out *telemetrySnapshot) any { return &out.LastMeaningfulProgressAt }},
	{"playback_stall_duration_ms",
		func(in telemetrySampleInput) any { return in.PlaybackStallDurationMS },
		func(out *telemetrySnapshot) any { return &out.PlaybackStallDurationMS }},
	{"stall_reason",
		func(in telemetrySampleInput) any { return in.StallReason },
		func(out *telemetrySnapshot) any { return &out.StallReason }},
	{"renderer_state",
		func(in telemetrySampleInput) any { return in.RendererState },
		func(out *telemetrySnapshot) any { return &out.RendererState }},
	{"renderer_responding",
		func(in telemetrySampleInput) any { return in.RendererResponding },
		func(out *telemetrySnapshot) any { return &out.RendererResponding }},
	{"expected_motion",
		func(in telemetrySampleInput) any { return in.ExpectedMotion },
		func(out *telemetrySnapshot) any { return &out.ExpectedMotion }},

	{"server_round_trip_ms",
		func(in telemetrySampleInput) any { return in.ServerRoundTripMS },
		func(out *telemetrySnapshot) any { return &out.ServerRoundTripMS }},
	{"download_queue_count",
		func(in telemetrySampleInput) any { return in.DownloadQueueCount },
		func(out *telemetrySnapshot) any { return &out.DownloadQueueCount }},
	{"bytes_remaining",
		func(in telemetrySampleInput) any { return in.BytesRemaining },
		func(out *telemetrySnapshot) any { return &out.BytesRemaining }},
	{"cache_used_bytes",
		func(in telemetrySampleInput) any { return in.CacheUsedBytes },
		func(out *telemetrySnapshot) any { return &out.CacheUsedBytes }},
	{"cache_limit_bytes",
		func(in telemetrySampleInput) any { return in.CacheLimitBytes },
		func(out *telemetrySnapshot) any { return &out.CacheLimitBytes }},
	{"free_storage_bytes",
		func(in telemetrySampleInput) any { return in.FreeStorageBytes },
		func(out *telemetrySnapshot) any { return &out.FreeStorageBytes }},

	{"process_uptime_seconds",
		func(in telemetrySampleInput) any { return in.ProcessUptimeSeconds },
		func(out *telemetrySnapshot) any { return &out.ProcessUptimeSeconds }},
	{"device_uptime_seconds",
		func(in telemetrySampleInput) any { return in.DeviceUptimeSeconds },
		func(out *telemetrySnapshot) any { return &out.DeviceUptimeSeconds }},
	{"sync_group_drift_ms",
		func(in telemetrySampleInput) any { return in.SyncGroupDriftMS },
		func(out *telemetrySnapshot) any { return &out.SyncGroupDriftMS }},

	{"frame_fingerprint",
		func(in telemetrySampleInput) any { return in.FrameFingerprint },
		func(out *telemetrySnapshot) any { return &out.FrameFingerprint }},
	{"average_luminance",
		func(in telemetrySampleInput) any { return in.AverageLuminance },
		func(out *telemetrySnapshot) any { return &out.AverageLuminance }},
	{"thermal_state",
		func(in telemetrySampleInput) any { return in.ThermalState },
		func(out *telemetrySnapshot) any { return &out.ThermalState }},
	{"memory_pressure_state",
		func(in telemetrySampleInput) any { return in.MemoryPressureState },
		func(out *telemetrySnapshot) any { return &out.MemoryPressureState }},

	{"network_link_type",
		func(in telemetrySampleInput) any { return in.NetworkLinkType },
		func(out *telemetrySnapshot) any { return &out.NetworkLinkType }},
	{"wifi_signal_dbm",
		func(in telemetrySampleInput) any { return in.WifiSignalDBM },
		func(out *telemetrySnapshot) any { return &out.WifiSignalDBM }},
	{"wifi_link_speed_mbps",
		func(in telemetrySampleInput) any { return in.WifiLinkSpeedMbps },
		func(out *telemetrySnapshot) any { return &out.WifiLinkSpeedMbps }},
	{"gateway_reachable",
		func(in telemetrySampleInput) any { return in.GatewayReachable },
		func(out *telemetrySnapshot) any { return &out.GatewayReachable }},
	{"captive_portal_suspected",
		func(in telemetrySampleInput) any { return in.CaptivePortalSuspected },
		func(out *telemetrySnapshot) any { return &out.CaptivePortalSuspected }},
	{"last_disconnect_reason",
		func(in telemetrySampleInput) any { return in.LastDisconnectReason },
		func(out *telemetrySnapshot) any { return &out.LastDisconnectReason }},

	{"display_connected",
		func(in telemetrySampleInput) any { return in.DisplayConnected },
		func(out *telemetrySnapshot) any { return &out.DisplayConnected }},
	{"display_resolution",
		func(in telemetrySampleInput) any { return in.DisplayResolution },
		func(out *telemetrySnapshot) any { return &out.DisplayResolution }},
	{"display_refresh_hz",
		func(in telemetrySampleInput) any { return in.DisplayRefreshHz },
		func(out *telemetrySnapshot) any { return &out.DisplayRefreshHz }},
	{"display_power_state",
		func(in telemetrySampleInput) any { return in.DisplayPowerState },
		func(out *telemetrySnapshot) any { return &out.DisplayPowerState }},
	{"last_shutdown_reason",
		func(in telemetrySampleInput) any { return in.LastShutdownReason },
		func(out *telemetrySnapshot) any { return &out.LastShutdownReason }},
	{"power_source",
		func(in telemetrySampleInput) any { return in.PowerSource },
		func(out *telemetrySnapshot) any { return &out.PowerSource }},
	{"battery_percent",
		func(in telemetrySampleInput) any { return in.BatteryPercent },
		func(out *telemetrySnapshot) any { return &out.BatteryPercent }},

	{"clock_offset_seconds",
		func(in telemetrySampleInput) any { return in.ClockOffsetSeconds },
		func(out *telemetrySnapshot) any { return &out.ClockOffsetSeconds }},
	{"time_sync_state",
		func(in telemetrySampleInput) any { return in.TimeSyncState },
		func(out *telemetrySnapshot) any { return &out.TimeSyncState }},

	{"startup_total_ms",
		func(in telemetrySampleInput) any { return in.StartupTotalMS },
		func(out *telemetrySnapshot) any { return &out.StartupTotalMS }},
	{"startup_config_ms",
		func(in telemetrySampleInput) any { return in.StartupConfigMS },
		func(out *telemetrySnapshot) any { return &out.StartupConfigMS }},
	{"startup_manifest_ms",
		func(in telemetrySampleInput) any { return in.StartupManifestMS },
		func(out *telemetrySnapshot) any { return &out.StartupManifestMS }},
	{"startup_asset_verify_ms",
		func(in telemetrySampleInput) any { return in.StartupAssetVerifyMS },
		func(out *telemetrySnapshot) any { return &out.StartupAssetVerifyMS }},
	{"startup_first_frame_ms",
		func(in telemetrySampleInput) any { return in.StartupFirstFrameMS },
		func(out *telemetrySnapshot) any { return &out.StartupFirstFrameMS }},

	{"video_decoder_path",
		func(in telemetrySampleInput) any { return in.VideoDecoderPath },
		func(out *telemetrySnapshot) any { return &out.VideoDecoderPath }},
	{"video_decoded_resolution",
		func(in telemetrySampleInput) any { return in.VideoDecodedResolution },
		func(out *telemetrySnapshot) any { return &out.VideoDecodedResolution }},
}

// telemetryRollupColumns is the five-minute bucket. Round-trip time is the one
// entry read from a gauge rather than from the interval block: it is an
// instantaneous measurement whose average and peak over the window are what
// matter.
var telemetryRollupColumns = []telemetryRollupColumn{
	{"average_round_trip_ms", mergeMean,
		func(in telemetrySampleInput) any { return floatOrNil(in.ServerRoundTripMS) },
		func(out *telemetryRollup) any { return &out.AverageRoundTripMS }},
	{"max_round_trip_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.ServerRoundTripMS },
		func(out *telemetryRollup) any { return &out.MaxRoundTripMS }},

	{"connected_seconds", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.ConnectedSeconds },
		func(out *telemetryRollup) any { return &out.ConnectedSeconds }},
	{"disconnected_seconds", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DisconnectedSeconds },
		func(out *telemetryRollup) any { return &out.DisconnectedSeconds }},
	{"healthy_playback_seconds", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.HealthyPlaybackSeconds },
		func(out *telemetryRollup) any { return &out.HealthyPlaybackSeconds }},
	{"stalled_playback_seconds", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.StalledPlaybackSeconds },
		func(out *telemetryRollup) any { return &out.StalledPlaybackSeconds }},
	{"black_output_seconds", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.BlackOutputSeconds },
		func(out *telemetryRollup) any { return &out.BlackOutputSeconds }},
	{"dropped_frames", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DroppedFrames },
		func(out *telemetryRollup) any { return &out.DroppedFrames }},
	{"frame_change_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.FrameChangeCount },
		func(out *telemetryRollup) any { return &out.FrameChangeCount }},
	{"downloaded_bytes", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DownloadedBytes },
		func(out *telemetryRollup) any { return &out.DownloadedBytes }},
	{"cache_hits", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.CacheHits },
		func(out *telemetryRollup) any { return &out.CacheHits }},
	{"cache_misses", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.CacheMisses },
		func(out *telemetryRollup) any { return &out.CacheMisses }},

	{"average_memory_bytes", mergeMean,
		func(in telemetrySampleInput) any { return in.Interval.AverageMemoryBytes },
		func(out *telemetryRollup) any { return &out.AverageMemoryBytes }},
	{"peak_memory_bytes", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.PeakMemoryBytes },
		func(out *telemetryRollup) any { return &out.PeakMemoryBytes }},
	{"average_cpu_percent", mergeMean,
		func(in telemetrySampleInput) any { return in.Interval.AverageCPUPercent },
		func(out *telemetryRollup) any { return &out.AverageCPUPercent }},
	{"thermal_distribution", mergeJSONBAdd,
		func(in telemetrySampleInput) any { return marshalThermalSeconds(in.Interval.ThermalSeconds) },
		func(out *telemetryRollup) any { return &out.thermalRaw }},

	{"sync_drift_p50_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.SyncDriftP50MS },
		func(out *telemetryRollup) any { return &out.SyncDriftP50MS }},
	{"sync_drift_p95_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.SyncDriftP95MS },
		func(out *telemetryRollup) any { return &out.SyncDriftP95MS }},
	{"sync_drift_max_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.SyncDriftMaxMS },
		func(out *telemetryRollup) any { return &out.SyncDriftMaxMS }},

	{"http_request_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.HTTPRequestCount },
		func(out *telemetryRollup) any { return &out.HTTPRequestCount }},
	{"http_failure_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.HTTPFailureCount },
		func(out *telemetryRollup) any { return &out.HTTPFailureCount }},
	{"http_client_error_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.HTTPClientErrorCount },
		func(out *telemetryRollup) any { return &out.HTTPClientErrorCount }},
	{"http_server_error_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.HTTPServerErrorCount },
		func(out *telemetryRollup) any { return &out.HTTPServerErrorCount }},
	{"request_retry_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.RequestRetryCount },
		func(out *telemetryRollup) any { return &out.RequestRetryCount }},
	{"socket_reconnect_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.SocketReconnectCount },
		func(out *telemetryRollup) any { return &out.SocketReconnectCount }},
	{"network_interface_change_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.NetworkInterfaceChangeCount },
		func(out *telemetryRollup) any { return &out.NetworkInterfaceChangeCount }},
	{"dns_resolve_p95_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.DNSResolveP95MS },
		func(out *telemetryRollup) any { return &out.DNSResolveP95MS }},
	{"tls_handshake_p95_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.TLSHandshakeP95MS },
		func(out *telemetryRollup) any { return &out.TLSHandshakeP95MS }},
	{"time_to_first_byte_p95_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.TimeToFirstByteP95MS },
		func(out *telemetryRollup) any { return &out.TimeToFirstByteP95MS }},
	{"average_throughput_bytes_per_second", mergeMean,
		func(in telemetrySampleInput) any { return in.Interval.AverageThroughputBytesPerSecond },
		func(out *telemetryRollup) any { return &out.AverageThroughputBytesPerSecond }},

	{"frame_time_p95_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.FrameTimeP95MS },
		func(out *telemetryRollup) any { return &out.FrameTimeP95MS }},
	{"frame_time_p99_ms", mergeMax,
		func(in telemetrySampleInput) any { return in.Interval.FrameTimeP99MS },
		func(out *telemetryRollup) any { return &out.FrameTimeP99MS }},
	{"jank_frame_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.JankFrameCount },
		func(out *telemetryRollup) any { return &out.JankFrameCount }},
	{"renderer_crash_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.RendererCrashCount },
		func(out *telemetryRollup) any { return &out.RendererCrashCount }},
	{"surface_lost_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.SurfaceLostCount },
		func(out *telemetryRollup) any { return &out.SurfaceLostCount }},
	{"decoder_init_failure_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DecoderInitFailureCount },
		func(out *telemetryRollup) any { return &out.DecoderInitFailureCount }},

	{"cache_eviction_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.CacheEvictionCount },
		func(out *telemetryRollup) any { return &out.CacheEvictionCount }},
	{"cache_evicted_bytes", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.CacheEvictedBytes },
		func(out *telemetryRollup) any { return &out.CacheEvictedBytes }},
	{"integrity_failure_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.IntegrityFailureCount },
		func(out *telemetryRollup) any { return &out.IntegrityFailureCount }},
	{"download_resume_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DownloadResumeCount },
		func(out *telemetryRollup) any { return &out.DownloadResumeCount }},
	{"download_failure_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DownloadFailureCount },
		func(out *telemetryRollup) any { return &out.DownloadFailureCount }},

	{"unexpected_reboot_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.UnexpectedRebootCount },
		func(out *telemetryRollup) any { return &out.UnexpectedRebootCount }},
	{"display_sleep_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DisplaySleepCount },
		func(out *telemetryRollup) any { return &out.DisplaySleepCount }},
	{"display_wake_count", mergeSum,
		func(in telemetrySampleInput) any { return in.Interval.DisplayWakeCount },
		func(out *telemetryRollup) any { return &out.DisplayWakeCount }},
}

// Every statement is assembled once at startup rather than per request.
var (
	telemetrySnapshotStatement = buildTelemetrySnapshotStatement()
	telemetryRollupStatement   = buildTelemetryRollupStatement()
	telemetryGaugeSelection    = telemetryColumnList(gaugeNames())
	telemetryRollupSelection   = telemetryColumnList(rollupNames())
)

// The snapshot is one row per screen, updated in place. Keeping a history here
// is what turns telemetry into an unbounded table. The trailing guard drops a
// late-arriving sample rather than letting it overwrite a newer one.
func buildTelemetrySnapshotStatement() string {
	const table = "screen_telemetry_snapshots"
	names := gaugeNames()
	placeholders := make([]string, 0, len(names))
	assignments := make([]string, 0, len(names))
	for index, name := range names {
		// Argument one is the screen ID, so gauges start at two.
		placeholders = append(placeholders, fmt.Sprintf("$%d", index+2))
		assignments = append(assignments, fmt.Sprintf("%s=EXCLUDED.%s", name, name))
	}
	return fmt.Sprintf(
		"INSERT INTO %s(screen_id,%s,updated_at) VALUES($1,%s,now())\n"+
			"ON CONFLICT(screen_id) DO UPDATE SET %s,updated_at=now()\n"+
			"WHERE %s.observed_at <= EXCLUDED.observed_at",
		table, telemetryColumnList(names), strings.Join(placeholders, ","),
		strings.Join(assignments, ","), table)
}

func buildTelemetryRollupStatement() string {
	const table = "screen_telemetry_rollups"
	placeholders := make([]string, 0, len(telemetryRollupColumns))
	assignments := []string{fmt.Sprintf("samples=%s.samples+1", table)}
	for index, column := range telemetryRollupColumns {
		// Arguments one and two are the screen ID and the bucket start.
		placeholder := fmt.Sprintf("$%d", index+3)
		if column.merge == mergeJSONBAdd {
			placeholder += "::jsonb"
		}
		placeholders = append(placeholders, placeholder)
		assignments = append(assignments, telemetryMergeAssignment(table, column))
	}
	return fmt.Sprintf(
		"INSERT INTO %s(screen_id,bucket_start,samples,%s) VALUES($1,$2,1,%s)\n"+
			"ON CONFLICT(screen_id,bucket_start) DO UPDATE SET %s",
		table, telemetryColumnList(rollupNames()), strings.Join(placeholders, ","),
		strings.Join(assignments, ",\n"))
}

func telemetryMergeAssignment(table string, column telemetryRollupColumn) string {
	name := column.name
	switch column.merge {
	case mergeSum:
		return fmt.Sprintf("%s=%s.%s+EXCLUDED.%s", name, table, name, name)
	case mergeMax:
		return fmt.Sprintf("%s=GREATEST(COALESCE(%s.%s,0),COALESCE(EXCLUDED.%s,0))", name, table, name, name)
	case mergeMean:
		// A reference to the existing row reads its pre-update value, so the
		// sample count here is the one the stored mean was computed over.
		return fmt.Sprintf(`%s=CASE
	WHEN EXCLUDED.%s IS NULL THEN %s.%s
	WHEN %s.%s IS NULL THEN EXCLUDED.%s
	ELSE (%s.%s * %s.samples + EXCLUDED.%s) / (%s.samples + 1)
END`, name, name, table, name, table, name, name, table, name, table, name, table)
	case mergeJSONBAdd:
		// The set-returning function names its column after itself, so the union
		// is aliased explicitly; and an aggregate over no keys is NULL, which a
		// NOT NULL column reads as an empty distribution.
		return fmt.Sprintf(`%s=COALESCE((
	SELECT jsonb_object_agg(keys.key, to_jsonb(COALESCE((%s.%s->>keys.key)::numeric,0) + COALESCE((EXCLUDED.%s->>keys.key)::numeric,0)))
	FROM (SELECT jsonb_object_keys(%s.%s) UNION SELECT jsonb_object_keys(EXCLUDED.%s)) AS keys(key)
),'{}'::jsonb)`, name, table, name, name, table, name, name)
	}
	panic("unknown telemetry merge mode")
}

func gaugeNames() []string {
	names := make([]string, 0, len(telemetryGaugeColumns))
	for _, column := range telemetryGaugeColumns {
		names = append(names, column.name)
	}
	return names
}

func rollupNames() []string {
	names := make([]string, 0, len(telemetryRollupColumns))
	for _, column := range telemetryRollupColumns {
		names = append(names, column.name)
	}
	return names
}

func telemetryColumnList(names []string) string { return strings.Join(names, ",") }

func telemetryGaugeArguments(screenID any, input telemetrySampleInput) []any {
	arguments := make([]any, 0, len(telemetryGaugeColumns)+1)
	arguments = append(arguments, screenID)
	for _, column := range telemetryGaugeColumns {
		arguments = append(arguments, column.value(input))
	}
	return arguments
}

func telemetryRollupArguments(screenID, bucket any, input telemetrySampleInput) []any {
	arguments := make([]any, 0, len(telemetryRollupColumns)+2)
	arguments = append(arguments, screenID, bucket)
	for _, column := range telemetryRollupColumns {
		arguments = append(arguments, column.value(input))
	}
	return arguments
}

// The scan targets come from the same table as the SELECT list, so the two
// cannot drift out of step.
func telemetryGaugeScanTargets(into *telemetrySnapshot) []any {
	targets := make([]any, 0, len(telemetryGaugeColumns))
	for _, column := range telemetryGaugeColumns {
		targets = append(targets, column.scan(into))
	}
	return targets
}

func telemetryRollupScanTargets(into *telemetryRollup) []any {
	targets := make([]any, 0, len(telemetryRollupColumns))
	for _, column := range telemetryRollupColumns {
		targets = append(targets, column.scan(into))
	}
	return targets
}
