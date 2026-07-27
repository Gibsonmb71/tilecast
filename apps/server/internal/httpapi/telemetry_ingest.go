package httpapi

import (
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

// Five minutes, matching the rollup bucket. Chosen because it is short enough
// to locate a problem in time and long enough that a fleet of a thousand
// screens produces a bounded number of rows per day.
const telemetryBucket = 5 * time.Minute

type telemetrySampleInput struct {
	ObservedAt time.Time `json:"observedAt"`

	CurrentItemID            string     `json:"currentItemId,omitempty"`
	ItemStartedAt            *time.Time `json:"itemStartedAt,omitempty"`
	LastMeaningfulProgressAt *time.Time `json:"lastMeaningfulProgressAt,omitempty"`
	PlaybackStallDurationMS  *int64     `json:"playbackStallDurationMs,omitempty"`
	StallReason              string     `json:"stallReason,omitempty"`
	RendererState            string     `json:"rendererState,omitempty"`
	RendererResponding       *bool      `json:"rendererResponding,omitempty"`
	ExpectedMotion           *bool      `json:"expectedMotion,omitempty"`

	ServerRoundTripMS  *int32 `json:"serverRoundTripMs,omitempty"`
	DownloadQueueCount *int32 `json:"downloadQueueCount,omitempty"`
	BytesRemaining     *int64 `json:"bytesRemaining,omitempty"`
	CacheUsedBytes     *int64 `json:"cacheUsedBytes,omitempty"`
	CacheLimitBytes    *int64 `json:"cacheLimitBytes,omitempty"`
	FreeStorageBytes   *int64 `json:"freeStorageBytes,omitempty"`

	ProcessUptimeSeconds *int64 `json:"processUptimeSeconds,omitempty"`
	DeviceUptimeSeconds  *int64 `json:"deviceUptimeSeconds,omitempty"`
	SyncGroupDriftMS     *int32 `json:"syncGroupDriftMs,omitempty"`

	// A short hash. Image data is never accepted, so Activity cannot end up
	// holding a picture of what is on someone's screen.
	FrameFingerprint    string   `json:"frameFingerprint,omitempty"`
	AverageLuminance    *float32 `json:"averageLuminance,omitempty"`
	ThermalState        string   `json:"thermalState,omitempty"`
	MemoryPressureState string   `json:"memoryPressureState,omitempty"`

	// Counters accumulated by the player since its previous sample. Sending
	// deltas rather than raw samples is what keeps this bounded.
	Interval telemetryIntervalInput `json:"interval"`
}

type telemetryIntervalInput struct {
	Seconds                int32              `json:"seconds"`
	ConnectedSeconds       int32              `json:"connectedSeconds"`
	DisconnectedSeconds    int32              `json:"disconnectedSeconds"`
	HealthyPlaybackSeconds int32              `json:"healthyPlaybackSeconds"`
	StalledPlaybackSeconds int32              `json:"stalledPlaybackSeconds"`
	BlackOutputSeconds     int32              `json:"blackOutputSeconds"`
	DroppedFrames          int64              `json:"droppedFrames"`
	FrameChangeCount       int64              `json:"frameChangeCount"`
	DownloadedBytes        int64              `json:"downloadedBytes"`
	CacheHits              int64              `json:"cacheHits"`
	CacheMisses            int64              `json:"cacheMisses"`
	AverageMemoryBytes     *int64             `json:"averageMemoryBytes,omitempty"`
	PeakMemoryBytes        *int64             `json:"peakMemoryBytes,omitempty"`
	AverageCPUPercent      *float32           `json:"averageCpuPercent,omitempty"`
	ThermalSeconds         map[string]float64 `json:"thermalSeconds,omitempty"`
	SyncDriftP50MS         *int32             `json:"syncDriftP50Ms,omitempty"`
	SyncDriftP95MS         *int32             `json:"syncDriftP95Ms,omitempty"`
	SyncDriftMaxMS         *int32             `json:"syncDriftMaxMs,omitempty"`
	// Consecutive download failures for one asset, for the threshold.
	ConsecutiveDownloadFailures int32 `json:"consecutiveDownloadFailures"`
}

func (s *server) ingestTelemetry(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	var input telemetrySampleInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "telemetry_invalid", err.Error())
		return
	}
	now := time.Now().UTC()
	if input.ObservedAt.IsZero() || input.ObservedAt.After(now.Add(15*time.Minute)) ||
		input.ObservedAt.Before(now.Add(-24*time.Hour)) {
		writeError(w, http.StatusUnprocessableEntity, "telemetry_timestamp_invalid",
			"observedAt is outside the accepted reporting window.")
		return
	}
	// An interval longer than a bucket would let one sample dominate a rollup,
	// so it is clamped rather than trusted.
	if input.Interval.Seconds < 0 || input.Interval.Seconds > int32(telemetryBucket.Seconds()) {
		input.Interval.Seconds = int32(telemetryBucket.Seconds())
	}
	sanitizeTelemetryText(&input)

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	if err := writeTelemetrySnapshot(r, tx, principal.ScreenID, input); err != nil {
		s.internalError(w, r, err)
		return
	}
	if err := writeTelemetryRollup(r, tx, principal.ScreenID, input); err != nil {
		s.internalError(w, r, err)
		return
	}
	// Conditions are evaluated on the sample's own clock, not on arrival time.
	// A player uploading a buffered backlog after an outage would otherwise
	// have every transition in it suppressed by the cooldown.
	if err := s.evaluateTelemetryConditions(r, tx, principal.ScreenID, input, input.ObservedAt.UTC()); err != nil {
		s.internalError(w, r, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]any{"accepted": true}})
}

// Free text from a player is bounded before it reaches storage, and the frame
// fingerprint is capped short enough that it cannot smuggle image data.
func sanitizeTelemetryText(input *telemetrySampleInput) {
	input.CurrentItemID = safeActivityText(input.CurrentItemID, 128)
	input.StallReason = safeActivityText(input.StallReason, 64)
	input.RendererState = safeActivityText(input.RendererState, 48)
	input.FrameFingerprint = safeActivityText(input.FrameFingerprint, 64)
	input.ThermalState = safeActivityText(input.ThermalState, 32)
	input.MemoryPressureState = safeActivityText(input.MemoryPressureState, 32)
}

// The snapshot is one row per screen, updated in place. Keeping a history here
// is what turns telemetry into an unbounded table.
func writeTelemetrySnapshot(r *http.Request, tx pgx.Tx, screenID uuid.UUID, input telemetrySampleInput) error {
	_, err := tx.Exec(r.Context(), `
		INSERT INTO screen_telemetry_snapshots(
			screen_id,observed_at,current_item_id,item_started_at,last_meaningful_progress_at,
			playback_stall_duration_ms,stall_reason,renderer_state,renderer_responding,expected_motion,
			server_round_trip_ms,download_queue_count,bytes_remaining,cache_used_bytes,cache_limit_bytes,
			free_storage_bytes,process_uptime_seconds,device_uptime_seconds,sync_group_drift_ms,
			frame_fingerprint,average_luminance,thermal_state,memory_pressure_state,updated_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,now())
		ON CONFLICT(screen_id) DO UPDATE SET
			observed_at=EXCLUDED.observed_at,current_item_id=EXCLUDED.current_item_id,
			item_started_at=EXCLUDED.item_started_at,
			last_meaningful_progress_at=EXCLUDED.last_meaningful_progress_at,
			playback_stall_duration_ms=EXCLUDED.playback_stall_duration_ms,
			stall_reason=EXCLUDED.stall_reason,renderer_state=EXCLUDED.renderer_state,
			renderer_responding=EXCLUDED.renderer_responding,expected_motion=EXCLUDED.expected_motion,
			server_round_trip_ms=EXCLUDED.server_round_trip_ms,
			download_queue_count=EXCLUDED.download_queue_count,bytes_remaining=EXCLUDED.bytes_remaining,
			cache_used_bytes=EXCLUDED.cache_used_bytes,cache_limit_bytes=EXCLUDED.cache_limit_bytes,
			free_storage_bytes=EXCLUDED.free_storage_bytes,
			process_uptime_seconds=EXCLUDED.process_uptime_seconds,
			device_uptime_seconds=EXCLUDED.device_uptime_seconds,
			sync_group_drift_ms=EXCLUDED.sync_group_drift_ms,
			frame_fingerprint=EXCLUDED.frame_fingerprint,average_luminance=EXCLUDED.average_luminance,
			thermal_state=EXCLUDED.thermal_state,memory_pressure_state=EXCLUDED.memory_pressure_state,
			updated_at=now()
		WHERE screen_telemetry_snapshots.observed_at <= EXCLUDED.observed_at`,
		screenID, input.ObservedAt, input.CurrentItemID, input.ItemStartedAt, input.LastMeaningfulProgressAt,
		input.PlaybackStallDurationMS, input.StallReason, input.RendererState, input.RendererResponding,
		input.ExpectedMotion, input.ServerRoundTripMS, input.DownloadQueueCount, input.BytesRemaining,
		input.CacheUsedBytes, input.CacheLimitBytes, input.FreeStorageBytes, input.ProcessUptimeSeconds,
		input.DeviceUptimeSeconds, input.SyncGroupDriftMS, input.FrameFingerprint, input.AverageLuminance,
		input.ThermalState, input.MemoryPressureState)
	return err
}

// Rollups accumulate into a five-minute bucket. Averages are recomputed as a
// running mean weighted by sample count, so a bucket receiving ten samples is
// not just the last one.
func writeTelemetryRollup(r *http.Request, tx pgx.Tx, screenID uuid.UUID, input telemetrySampleInput) error {
	bucket := input.ObservedAt.UTC().Truncate(telemetryBucket)
	interval := input.Interval
	thermal, _ := json.Marshal(sanitizeThermalSeconds(interval.ThermalSeconds))
	_, err := tx.Exec(r.Context(), `
		INSERT INTO screen_telemetry_rollups(
			screen_id,bucket_start,samples,average_round_trip_ms,max_round_trip_ms,
			connected_seconds,disconnected_seconds,healthy_playback_seconds,stalled_playback_seconds,
			black_output_seconds,dropped_frames,frame_change_count,downloaded_bytes,cache_hits,cache_misses,
			average_memory_bytes,peak_memory_bytes,average_cpu_percent,thermal_distribution,
			sync_drift_p50_ms,sync_drift_p95_ms,sync_drift_max_ms)
		VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21)
		ON CONFLICT(screen_id,bucket_start) DO UPDATE SET
			samples=screen_telemetry_rollups.samples+1,
			-- Running mean, so every sample in the bucket counts equally.
			average_round_trip_ms=CASE
				WHEN EXCLUDED.average_round_trip_ms IS NULL THEN screen_telemetry_rollups.average_round_trip_ms
				WHEN screen_telemetry_rollups.average_round_trip_ms IS NULL THEN EXCLUDED.average_round_trip_ms
				ELSE (screen_telemetry_rollups.average_round_trip_ms * screen_telemetry_rollups.samples
				      + EXCLUDED.average_round_trip_ms) / (screen_telemetry_rollups.samples + 1)
			END,
			max_round_trip_ms=GREATEST(COALESCE(screen_telemetry_rollups.max_round_trip_ms,0),COALESCE(EXCLUDED.max_round_trip_ms,0)),
			connected_seconds=screen_telemetry_rollups.connected_seconds+EXCLUDED.connected_seconds,
			disconnected_seconds=screen_telemetry_rollups.disconnected_seconds+EXCLUDED.disconnected_seconds,
			healthy_playback_seconds=screen_telemetry_rollups.healthy_playback_seconds+EXCLUDED.healthy_playback_seconds,
			stalled_playback_seconds=screen_telemetry_rollups.stalled_playback_seconds+EXCLUDED.stalled_playback_seconds,
			black_output_seconds=screen_telemetry_rollups.black_output_seconds+EXCLUDED.black_output_seconds,
			dropped_frames=screen_telemetry_rollups.dropped_frames+EXCLUDED.dropped_frames,
			frame_change_count=screen_telemetry_rollups.frame_change_count+EXCLUDED.frame_change_count,
			downloaded_bytes=screen_telemetry_rollups.downloaded_bytes+EXCLUDED.downloaded_bytes,
			cache_hits=screen_telemetry_rollups.cache_hits+EXCLUDED.cache_hits,
			cache_misses=screen_telemetry_rollups.cache_misses+EXCLUDED.cache_misses,
			average_memory_bytes=CASE
				WHEN EXCLUDED.average_memory_bytes IS NULL THEN screen_telemetry_rollups.average_memory_bytes
				WHEN screen_telemetry_rollups.average_memory_bytes IS NULL THEN EXCLUDED.average_memory_bytes
				ELSE (screen_telemetry_rollups.average_memory_bytes * screen_telemetry_rollups.samples
				      + EXCLUDED.average_memory_bytes) / (screen_telemetry_rollups.samples + 1)
			END,
			peak_memory_bytes=GREATEST(COALESCE(screen_telemetry_rollups.peak_memory_bytes,0),COALESCE(EXCLUDED.peak_memory_bytes,0)),
			average_cpu_percent=CASE
				WHEN EXCLUDED.average_cpu_percent IS NULL THEN screen_telemetry_rollups.average_cpu_percent
				WHEN screen_telemetry_rollups.average_cpu_percent IS NULL THEN EXCLUDED.average_cpu_percent
				ELSE (screen_telemetry_rollups.average_cpu_percent * screen_telemetry_rollups.samples
				      + EXCLUDED.average_cpu_percent) / (screen_telemetry_rollups.samples + 1)
			END,
			thermal_distribution=screen_telemetry_rollups.thermal_distribution || EXCLUDED.thermal_distribution,
			-- Percentiles cannot be merged without the samples, so the bucket
			-- keeps the worst reported figure rather than inventing a blend.
			sync_drift_p50_ms=GREATEST(COALESCE(screen_telemetry_rollups.sync_drift_p50_ms,0),COALESCE(EXCLUDED.sync_drift_p50_ms,0)),
			sync_drift_p95_ms=GREATEST(COALESCE(screen_telemetry_rollups.sync_drift_p95_ms,0),COALESCE(EXCLUDED.sync_drift_p95_ms,0)),
			sync_drift_max_ms=GREATEST(COALESCE(screen_telemetry_rollups.sync_drift_max_ms,0),COALESCE(EXCLUDED.sync_drift_max_ms,0))`,
		screenID, bucket, floatOrNil(input.ServerRoundTripMS), input.ServerRoundTripMS,
		interval.ConnectedSeconds, interval.DisconnectedSeconds, interval.HealthyPlaybackSeconds,
		interval.StalledPlaybackSeconds, interval.BlackOutputSeconds, interval.DroppedFrames,
		interval.FrameChangeCount, interval.DownloadedBytes, interval.CacheHits, interval.CacheMisses,
		interval.AverageMemoryBytes, interval.PeakMemoryBytes, interval.AverageCPUPercent, string(thermal),
		interval.SyncDriftP50MS, interval.SyncDriftP95MS, interval.SyncDriftMaxMS)
	return err
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

func floatOrNil(value *int32) *float64 {
	if value == nil {
		return nil
	}
	converted := float64(*value)
	return &converted
}
