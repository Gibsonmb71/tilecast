package httpapi

import (
	"math"
	"regexp"
	"time"
)

// Everything a player reports passes through here before it reaches storage.
// Three rules, in order of how much trouble they save:
//
//  1. Free text is bounded, and a field describing a *state* is an allowlist
//     rather than a length limit. That is what keeps telemetry from becoming
//     writable storage, and it is why no column here can hold an SSID, a
//     hostname, a path, or a URL even if a player sends one.
//  2. Out-of-range optional measurements are dropped, not clamped. A luminance
//     of 4 is not a dark screen and should not be recorded as one; absent is
//     the honest answer, and the conditions already distinguish "not reported"
//     from zero.
//  3. Counters are clamped into range instead. They are NOT NULL columns that
//     accumulate, so a negative or absurd delta is not merely wrong — it
//     violates a CHECK or overflows the bucket, turning one bad sample into a
//     failed request for a screen that is otherwise reporting fine.
type telemetryNumber interface {
	~int32 | ~int64 | ~float32
}

// Dropped rather than clamped: see rule 2.
func telemetryWithin[T telemetryNumber](value *T, minimum, maximum T) *T {
	if value == nil || *value < minimum || *value > maximum {
		return nil
	}
	return value
}

// For percentiles reported as a signed offset. Their meaning is the size of the
// deviation, so the sign carries no information and the magnitude is kept.
func telemetryMagnitude[T telemetryNumber](value *T, maximum T) *T {
	if value == nil {
		return nil
	}
	magnitude := *value
	if magnitude < 0 {
		magnitude = -magnitude
	}
	if magnitude > maximum {
		return nil
	}
	return &magnitude
}

// Clamped rather than dropped: see rule 3.
func telemetryClamp[T telemetryNumber](value, minimum, maximum T) T {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

// Ceilings for the accumulating counters. None of these is a plausible reading
// for a five-minute window; they exist so that no single sample can push a
// bucket toward a bigint overflow.
const (
	telemetryMaxIntervalSeconds = int32(telemetryBucket / time.Second)
	telemetryMaxCount           = int64(1) << 40
	telemetryMaxBytes           = int64(1) << 50
	// Ten minutes. Any request slower than this has failed, whatever it reports.
	telemetryMaxLatencyMS = int32(600_000)
)

// Allowlisted states. A value outside its list is dropped, so an unrecognized
// state reads as "not reported" instead of as a new state nothing understands.
var (
	telemetryLinkTypes  = telemetrySet("ethernet", "wifi", "cellular", "other", "unknown")
	telemetryPowerState = telemetrySet("on", "standby", "off", "unknown")
	telemetryPowerSrc   = telemetrySet("mains", "battery", "ups", "unknown")
	telemetryClockSync  = telemetrySet("synchronized", "unsynchronized", "unknown")
	telemetryDecodePath = telemetrySet("hardware", "software", "mixed", "unknown")
	// Disconnect and shutdown reasons are categories, not messages. An operator
	// needs to know which class of failure occurred; the message that produced
	// it belongs in the player's own log, not in a fleet-wide table.
	telemetryDisconnectReasons = telemetrySet(
		"network_lost", "server_unreachable", "timeout", "tls_failure",
		"credential_rejected", "server_closed", "client_closed", "process_restart", "unknown")
	telemetryShutdownReasons = telemetrySet(
		"clean", "power_loss", "kernel_panic", "thermal", "watchdog", "update", "unknown")
)

func telemetrySet(values ...string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value] = true
	}
	return set
}

func safeTelemetryState(value string, allowed map[string]bool) string {
	value = safeActivityText(value, 32)
	if !allowed[value] {
		return ""
	}
	return value
}

// A resolution is two small integers and nothing else, which is narrow enough
// that the field cannot carry anything but a resolution.
var telemetryResolutionPattern = regexp.MustCompile(`^[0-9]{1,5}x[0-9]{1,5}$`)

func safeTelemetryResolution(value string) string {
	value = safeActivityText(value, 12)
	if !telemetryResolutionPattern.MatchString(value) {
		return ""
	}
	return value
}

func sanitizeTelemetrySample(input *telemetrySampleInput) {
	input.CurrentItemID = safeActivityText(input.CurrentItemID, 128)
	input.StallReason = safeActivityText(input.StallReason, 64)
	input.RendererState = safeActivityText(input.RendererState, 48)
	input.FrameFingerprint = safeActivityText(input.FrameFingerprint, 64)
	input.ThermalState = safeActivityText(input.ThermalState, 32)
	input.MemoryPressureState = safeActivityText(input.MemoryPressureState, 32)

	input.NetworkLinkType = safeTelemetryState(input.NetworkLinkType, telemetryLinkTypes)
	input.LastDisconnectReason = safeTelemetryState(input.LastDisconnectReason, telemetryDisconnectReasons)
	input.DisplayPowerState = safeTelemetryState(input.DisplayPowerState, telemetryPowerState)
	input.LastShutdownReason = safeTelemetryState(input.LastShutdownReason, telemetryShutdownReasons)
	input.PowerSource = safeTelemetryState(input.PowerSource, telemetryPowerSrc)
	input.TimeSyncState = safeTelemetryState(input.TimeSyncState, telemetryClockSync)
	input.VideoDecoderPath = safeTelemetryState(input.VideoDecoderPath, telemetryDecodePath)
	input.DisplayResolution = safeTelemetryResolution(input.DisplayResolution)
	input.VideoDecodedResolution = safeTelemetryResolution(input.VideoDecodedResolution)

	sanitizeTelemetryGauges(input)
	sanitizeTelemetryCounters(&input.Interval)
}

// The bounds mirror the column constraints. Keeping them here rather than
// relying on the database means a single bad field is dropped, instead of
// failing the whole request and losing the sample's good measurements with it.
func sanitizeTelemetryGauges(input *telemetrySampleInput) {
	const day = int64(86_400)

	input.PlaybackStallDurationMS = telemetryWithin(input.PlaybackStallDurationMS, 0, telemetryMaxCount)
	input.ServerRoundTripMS = telemetryWithin(input.ServerRoundTripMS, 0, telemetryMaxLatencyMS)
	input.DownloadQueueCount = telemetryWithin(input.DownloadQueueCount, 0, math.MaxInt32)
	input.BytesRemaining = telemetryWithin(input.BytesRemaining, 0, telemetryMaxBytes)
	input.CacheUsedBytes = telemetryWithin(input.CacheUsedBytes, 0, telemetryMaxBytes)
	input.CacheLimitBytes = telemetryWithin(input.CacheLimitBytes, 0, telemetryMaxBytes)
	input.FreeStorageBytes = telemetryWithin(input.FreeStorageBytes, 0, telemetryMaxBytes)
	input.ProcessUptimeSeconds = telemetryWithin(input.ProcessUptimeSeconds, 0, 400*day)
	input.DeviceUptimeSeconds = telemetryWithin(input.DeviceUptimeSeconds, 0, 400*day)
	input.AverageLuminance = telemetryWithin(input.AverageLuminance, 0, 1)

	input.WifiSignalDBM = telemetryWithin(input.WifiSignalDBM, -120, 0)
	input.WifiLinkSpeedMbps = telemetryWithin(input.WifiLinkSpeedMbps, 0, 1_000_000)
	input.DisplayRefreshHz = telemetryWithin(input.DisplayRefreshHz, 0, 480)
	input.BatteryPercent = telemetryWithin(input.BatteryPercent, 0, 100)
	// Signed on purpose: a device clock can be behind or ahead, and which one it
	// is decides whether content ran early or late.
	input.ClockOffsetSeconds = telemetryWithin(input.ClockOffsetSeconds, -int32(400*day), int32(400*day))

	startupCeiling := int64(6 * 3_600 * 1_000)
	input.StartupTotalMS = telemetryWithin(input.StartupTotalMS, 0, startupCeiling)
	input.StartupConfigMS = telemetryWithin(input.StartupConfigMS, 0, startupCeiling)
	input.StartupManifestMS = telemetryWithin(input.StartupManifestMS, 0, startupCeiling)
	input.StartupAssetVerifyMS = telemetryWithin(input.StartupAssetVerifyMS, 0, startupCeiling)
	input.StartupFirstFrameMS = telemetryWithin(input.StartupFirstFrameMS, 0, startupCeiling)
}

func sanitizeTelemetryCounters(interval *telemetryIntervalInput) {
	seconds := telemetryMaxIntervalSeconds

	// No sample can contribute more seconds of anything than the bucket holds.
	interval.ConnectedSeconds = telemetryClamp(interval.ConnectedSeconds, 0, seconds)
	interval.DisconnectedSeconds = telemetryClamp(interval.DisconnectedSeconds, 0, seconds)
	interval.HealthyPlaybackSeconds = telemetryClamp(interval.HealthyPlaybackSeconds, 0, seconds)
	interval.StalledPlaybackSeconds = telemetryClamp(interval.StalledPlaybackSeconds, 0, seconds)
	interval.BlackOutputSeconds = telemetryClamp(interval.BlackOutputSeconds, 0, seconds)

	interval.DroppedFrames = telemetryClamp(interval.DroppedFrames, 0, telemetryMaxCount)
	interval.FrameChangeCount = telemetryClamp(interval.FrameChangeCount, 0, telemetryMaxCount)
	interval.DownloadedBytes = telemetryClamp(interval.DownloadedBytes, 0, telemetryMaxBytes)
	interval.CacheHits = telemetryClamp(interval.CacheHits, 0, telemetryMaxCount)
	interval.CacheMisses = telemetryClamp(interval.CacheMisses, 0, telemetryMaxCount)
	interval.ConsecutiveDownloadFailures = telemetryClamp(interval.ConsecutiveDownloadFailures, 0, math.MaxInt32)

	interval.HTTPRequestCount = telemetryClamp(interval.HTTPRequestCount, 0, telemetryMaxCount)
	interval.HTTPFailureCount = telemetryClamp(interval.HTTPFailureCount, 0, telemetryMaxCount)
	interval.HTTPClientErrorCount = telemetryClamp(interval.HTTPClientErrorCount, 0, telemetryMaxCount)
	interval.HTTPServerErrorCount = telemetryClamp(interval.HTTPServerErrorCount, 0, telemetryMaxCount)
	interval.RequestRetryCount = telemetryClamp(interval.RequestRetryCount, 0, telemetryMaxCount)
	interval.SocketReconnectCount = telemetryClamp(interval.SocketReconnectCount, 0, telemetryMaxCount)
	interval.NetworkInterfaceChangeCount = telemetryClamp(interval.NetworkInterfaceChangeCount, 0, telemetryMaxCount)

	interval.JankFrameCount = telemetryClamp(interval.JankFrameCount, 0, telemetryMaxCount)
	interval.RendererCrashCount = telemetryClamp(interval.RendererCrashCount, 0, telemetryMaxCount)
	interval.SurfaceLostCount = telemetryClamp(interval.SurfaceLostCount, 0, telemetryMaxCount)
	interval.DecoderInitFailureCount = telemetryClamp(interval.DecoderInitFailureCount, 0, telemetryMaxCount)

	interval.CacheEvictionCount = telemetryClamp(interval.CacheEvictionCount, 0, telemetryMaxCount)
	interval.CacheEvictedBytes = telemetryClamp(interval.CacheEvictedBytes, 0, telemetryMaxBytes)
	interval.IntegrityFailureCount = telemetryClamp(interval.IntegrityFailureCount, 0, telemetryMaxCount)
	interval.DownloadResumeCount = telemetryClamp(interval.DownloadResumeCount, 0, telemetryMaxCount)
	interval.DownloadFailureCount = telemetryClamp(interval.DownloadFailureCount, 0, telemetryMaxCount)

	interval.UnexpectedRebootCount = telemetryClamp(interval.UnexpectedRebootCount, 0, telemetryMaxCount)
	interval.DisplaySleepCount = telemetryClamp(interval.DisplaySleepCount, 0, telemetryMaxCount)
	interval.DisplayWakeCount = telemetryClamp(interval.DisplayWakeCount, 0, telemetryMaxCount)

	// Nullable aggregates keep the drop-rather-than-clamp rule: an implausible
	// average is not evidence of anything and should not sit in a chart.
	interval.AverageMemoryBytes = telemetryWithin(interval.AverageMemoryBytes, 0, telemetryMaxBytes)
	interval.PeakMemoryBytes = telemetryWithin(interval.PeakMemoryBytes, 0, telemetryMaxBytes)
	// Above 100 is normal: the figure is summed across cores.
	interval.AverageCPUPercent = telemetryWithin(interval.AverageCPUPercent, 0, 6_400)
	interval.AverageThroughputBytesPerSecond =
		telemetryWithin(interval.AverageThroughputBytesPerSecond, 0, telemetryMaxBytes)

	interval.SyncDriftP50MS = telemetryMagnitude(interval.SyncDriftP50MS, math.MaxInt32)
	interval.SyncDriftP95MS = telemetryMagnitude(interval.SyncDriftP95MS, math.MaxInt32)
	interval.SyncDriftMaxMS = telemetryMagnitude(interval.SyncDriftMaxMS, math.MaxInt32)

	interval.DNSResolveP95MS = telemetryWithin(interval.DNSResolveP95MS, 0, telemetryMaxLatencyMS)
	interval.TLSHandshakeP95MS = telemetryWithin(interval.TLSHandshakeP95MS, 0, telemetryMaxLatencyMS)
	interval.TimeToFirstByteP95MS = telemetryWithin(interval.TimeToFirstByteP95MS, 0, telemetryMaxLatencyMS)
	interval.FrameTimeP95MS = telemetryWithin(interval.FrameTimeP95MS, 0, 60_000)
	interval.FrameTimeP99MS = telemetryWithin(interval.FrameTimeP99MS, 0, 60_000)
}

// The thermal distribution is a small bounded object, not an arbitrary map a
// player could grow without limit.
func sanitizeThermalSeconds(value map[string]float64) map[string]float64 {
	if len(value) == 0 {
		return map[string]float64{}
	}
	allowed := map[string]bool{
		"nominal": true, "fair": true, "serious": true,
		"severe": true, "critical": true, "emergency": true, "shutdown": true,
	}
	clean := map[string]float64{}
	for state, seconds := range value {
		if allowed[state] && seconds > 0 && seconds <= telemetryBucket.Seconds() {
			clean[state] = math.Round(seconds)
		}
	}
	return clean
}
