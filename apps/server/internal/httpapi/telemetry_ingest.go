package httpapi

import (
	"encoding/json"
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

	// Network path. Deliberately describes the link and not the network: the
	// interface class, the radio's own numbers, and the player's reachability
	// verdict. No SSID, hostname, address, or URL is accepted here.
	NetworkLinkType        string `json:"networkLinkType,omitempty"`
	WifiSignalDBM          *int32 `json:"wifiSignalDbm,omitempty"`
	WifiLinkSpeedMbps      *int32 `json:"wifiLinkSpeedMbps,omitempty"`
	GatewayReachable       *bool  `json:"gatewayReachable,omitempty"`
	CaptivePortalSuspected *bool  `json:"captivePortalSuspected,omitempty"`
	LastDisconnectReason   string `json:"lastDisconnectReason,omitempty"`

	// Display and power, which is how a display fault is told apart from a
	// player fault without someone standing in front of the screen.
	DisplayConnected   *bool    `json:"displayConnected,omitempty"`
	DisplayResolution  string   `json:"displayResolution,omitempty"`
	DisplayRefreshHz   *float32 `json:"displayRefreshHz,omitempty"`
	DisplayPowerState  string   `json:"displayPowerState,omitempty"`
	LastShutdownReason string   `json:"lastShutdownReason,omitempty"`
	PowerSource        string   `json:"powerSource,omitempty"`
	BatteryPercent     *int32   `json:"batteryPercent,omitempty"`

	// Clock. Offline scheduling runs on the device clock, so drift presents as
	// content appearing at the wrong time with no other symptom.
	ClockOffsetSeconds *int32 `json:"clockOffsetSeconds,omitempty"`
	TimeSyncState      string `json:"timeSyncState,omitempty"`

	// Startup timing for the current process, so a slow recovery after a power
	// cut can be attributed to a phase instead of guessed at.
	StartupTotalMS       *int64 `json:"startupTotalMs,omitempty"`
	StartupConfigMS      *int64 `json:"startupConfigMs,omitempty"`
	StartupManifestMS    *int64 `json:"startupManifestMs,omitempty"`
	StartupAssetVerifyMS *int64 `json:"startupAssetVerifyMs,omitempty"`
	StartupFirstFrameMS  *int64 `json:"startupFirstFrameMs,omitempty"`

	VideoDecoderPath       string `json:"videoDecoderPath,omitempty"`
	VideoDecodedResolution string `json:"videoDecodedResolution,omitempty"`

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

	// Request outcomes by class. A single failure total cannot tell a revoked
	// credential from an overloaded server or a dead link.
	HTTPRequestCount            int64 `json:"httpRequestCount"`
	HTTPFailureCount            int64 `json:"httpFailureCount"`
	HTTPClientErrorCount        int64 `json:"httpClientErrorCount"`
	HTTPServerErrorCount        int64 `json:"httpServerErrorCount"`
	RequestRetryCount           int64 `json:"requestRetryCount"`
	SocketReconnectCount        int64 `json:"socketReconnectCount"`
	NetworkInterfaceChangeCount int64 `json:"networkInterfaceChangeCount"`
	// Connection setup, split from transfer: a slow resolver and a slow link
	// both present as "the screen is slow to update".
	DNSResolveP95MS                 *int32 `json:"dnsResolveP95Ms,omitempty"`
	TLSHandshakeP95MS               *int32 `json:"tlsHandshakeP95Ms,omitempty"`
	TimeToFirstByteP95MS            *int32 `json:"timeToFirstByteP95Ms,omitempty"`
	AverageThroughputBytesPerSecond *int64 `json:"averageThroughputBytesPerSecond,omitempty"`

	// Render timing. A screen can hold its frame rate and still visibly
	// stutter, which dropped-frame counts alone do not show.
	FrameTimeP95MS          *float32 `json:"frameTimeP95Ms,omitempty"`
	FrameTimeP99MS          *float32 `json:"frameTimeP99Ms,omitempty"`
	JankFrameCount          int64    `json:"jankFrameCount"`
	RendererCrashCount      int64    `json:"rendererCrashCount"`
	SurfaceLostCount        int64    `json:"surfaceLostCount"`
	DecoderInitFailureCount int64    `json:"decoderInitFailureCount"`

	// Cache churn, as distinct from cache hits and misses: whether the cache is
	// thrashing, resuming, or failing verification.
	CacheEvictionCount    int64 `json:"cacheEvictionCount"`
	CacheEvictedBytes     int64 `json:"cacheEvictedBytes"`
	IntegrityFailureCount int64 `json:"integrityFailureCount"`
	DownloadResumeCount   int64 `json:"downloadResumeCount"`
	DownloadFailureCount  int64 `json:"downloadFailureCount"`

	UnexpectedRebootCount int64 `json:"unexpectedRebootCount"`
	DisplaySleepCount     int64 `json:"displaySleepCount"`
	DisplayWakeCount      int64 `json:"displayWakeCount"`
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
	if input.Interval.Seconds < 0 {
		writeError(w, http.StatusUnprocessableEntity, "telemetry_interval_invalid", "Interval seconds cannot be negative.")
		return
	}
	if input.Interval.Seconds > int32(telemetryBucket.Seconds()) {
		input.Interval.Seconds = int32(telemetryBucket.Seconds())
	}
	sanitizeTelemetrySample(&input)

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

func writeTelemetrySnapshot(r *http.Request, tx pgx.Tx, screenID uuid.UUID, input telemetrySampleInput) error {
	_, err := tx.Exec(r.Context(), telemetrySnapshotStatement, telemetryGaugeArguments(screenID, input)...)
	return err
}

func writeTelemetryRollup(r *http.Request, tx pgx.Tx, screenID uuid.UUID, input telemetrySampleInput) error {
	bucket := input.ObservedAt.UTC().Truncate(telemetryBucket)
	_, err := tx.Exec(r.Context(), telemetryRollupStatement, telemetryRollupArguments(screenID, bucket, input)...)
	return err
}

func marshalThermalSeconds(value map[string]float64) string {
	encoded, _ := json.Marshal(sanitizeThermalSeconds(value))
	return string(encoded)
}

func floatOrNil(value *int32) *float64 {
	if value == nil {
		return nil
	}
	converted := float64(*value)
	return &converted
}
