package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type telemetrySnapshot struct {
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

	FrameFingerprint    string   `json:"frameFingerprint,omitempty"`
	AverageLuminance    *float32 `json:"averageLuminance,omitempty"`
	ThermalState        string   `json:"thermalState,omitempty"`
	MemoryPressureState string   `json:"memoryPressureState,omitempty"`
}

type telemetryRollup struct {
	BucketStart            time.Time          `json:"bucketStart"`
	Samples                int32              `json:"samples"`
	AverageRoundTripMS     *float32           `json:"averageRoundTripMs,omitempty"`
	MaxRoundTripMS         *int32             `json:"maxRoundTripMs,omitempty"`
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
	ThermalDistribution    map[string]float64 `json:"thermalDistribution"`
	SyncDriftP50MS         *int32             `json:"syncDriftP50Ms,omitempty"`
	SyncDriftP95MS         *int32             `json:"syncDriftP95Ms,omitempty"`
	SyncDriftMaxMS         *int32             `json:"syncDriftMaxMs,omitempty"`
}

type telemetryCondition struct {
	Condition       string     `json:"condition"`
	Active          bool       `json:"active"`
	EnteredAt       *time.Time `json:"enteredAt,omitempty"`
	ExitedAt        *time.Time `json:"exitedAt,omitempty"`
	OccurrenceCount int64      `json:"occurrenceCount"`
}

type screenTelemetryResponse struct {
	Range struct {
		From time.Time `json:"from"`
		To   time.Time `json:"to"`
	} `json:"range"`
	// Absent when the player has never reported telemetry, which is different
	// from having reported zeroes.
	Snapshot   *telemetrySnapshot   `json:"snapshot"`
	Conditions []telemetryCondition `json:"conditions"`
	Rollups    []telemetryRollup    `json:"rollups"`
}

func (s *server) screenTelemetry(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/activity/screens/")
	screenID, err := uuid.Parse(strings.TrimSuffix(path, "/telemetry"))
	if err != nil {
		writeError(w, http.StatusNotFound, "screen_not_found", "Screen was not found.")
		return
	}
	window, err := parseActivityWindow(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_range_invalid", err.Error())
		return
	}

	response := screenTelemetryResponse{
		Conditions: []telemetryCondition{},
		Rollups:    []telemetryRollup{},
	}
	response.Range.From, response.Range.To = window.From, window.To

	var snapshot telemetrySnapshot
	if err := s.db.QueryRow(r.Context(), `
		SELECT observed_at,current_item_id,item_started_at,last_meaningful_progress_at,
		       playback_stall_duration_ms,stall_reason,renderer_state,renderer_responding,expected_motion,
		       server_round_trip_ms,download_queue_count,bytes_remaining,cache_used_bytes,cache_limit_bytes,
		       free_storage_bytes,process_uptime_seconds,device_uptime_seconds,sync_group_drift_ms,
		       frame_fingerprint,average_luminance,thermal_state,memory_pressure_state
		FROM screen_telemetry_snapshots WHERE screen_id=$1`, screenID).Scan(
		&snapshot.ObservedAt, &snapshot.CurrentItemID, &snapshot.ItemStartedAt,
		&snapshot.LastMeaningfulProgressAt, &snapshot.PlaybackStallDurationMS, &snapshot.StallReason,
		&snapshot.RendererState, &snapshot.RendererResponding, &snapshot.ExpectedMotion,
		&snapshot.ServerRoundTripMS, &snapshot.DownloadQueueCount, &snapshot.BytesRemaining,
		&snapshot.CacheUsedBytes, &snapshot.CacheLimitBytes, &snapshot.FreeStorageBytes,
		&snapshot.ProcessUptimeSeconds, &snapshot.DeviceUptimeSeconds, &snapshot.SyncGroupDriftMS,
		&snapshot.FrameFingerprint, &snapshot.AverageLuminance, &snapshot.ThermalState,
		&snapshot.MemoryPressureState); err == nil {
		response.Snapshot = &snapshot
	} else if err != pgx.ErrNoRows {
		s.internalError(w, r, err)
		return
	}

	conditionRows, err := s.db.Query(r.Context(), `
		SELECT condition,active,entered_at,exited_at,occurrence_count
		FROM screen_telemetry_conditions WHERE screen_id=$1 ORDER BY active DESC,condition`, screenID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer conditionRows.Close()
	for conditionRows.Next() {
		var item telemetryCondition
		if err := conditionRows.Scan(&item.Condition, &item.Active, &item.EnteredAt,
			&item.ExitedAt, &item.OccurrenceCount); err != nil {
			s.internalError(w, r, err)
			return
		}
		response.Conditions = append(response.Conditions, item)
	}
	if err := conditionRows.Err(); err != nil {
		s.internalError(w, r, err)
		return
	}

	rollupRows, err := s.db.Query(r.Context(), `
		SELECT bucket_start,samples,average_round_trip_ms,max_round_trip_ms,
		       connected_seconds,disconnected_seconds,healthy_playback_seconds,stalled_playback_seconds,
		       black_output_seconds,dropped_frames,frame_change_count,downloaded_bytes,cache_hits,cache_misses,
		       average_memory_bytes,peak_memory_bytes,average_cpu_percent,thermal_distribution,
		       sync_drift_p50_ms,sync_drift_p95_ms,sync_drift_max_ms
		FROM screen_telemetry_rollups
		WHERE screen_id=$1 AND bucket_start>=$2 AND bucket_start<$3
		ORDER BY bucket_start DESC LIMIT 600`, screenID, window.From, window.To)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rollupRows.Close()
	for rollupRows.Next() {
		var item telemetryRollup
		var thermal []byte
		if err := rollupRows.Scan(&item.BucketStart, &item.Samples, &item.AverageRoundTripMS, &item.MaxRoundTripMS,
			&item.ConnectedSeconds, &item.DisconnectedSeconds, &item.HealthyPlaybackSeconds,
			&item.StalledPlaybackSeconds, &item.BlackOutputSeconds, &item.DroppedFrames,
			&item.FrameChangeCount, &item.DownloadedBytes, &item.CacheHits, &item.CacheMisses,
			&item.AverageMemoryBytes, &item.PeakMemoryBytes, &item.AverageCPUPercent, &thermal,
			&item.SyncDriftP50MS, &item.SyncDriftP95MS, &item.SyncDriftMaxMS); err != nil {
			s.internalError(w, r, err)
			return
		}
		item.ThermalDistribution = map[string]float64{}
		_ = json.Unmarshal(thermal, &item.ThermalDistribution)
		response.Rollups = append(response.Rollups, item)
	}
	if err := rollupRows.Err(); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": response})
}
