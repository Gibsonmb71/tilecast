package httpapi

import (
	"encoding/json"
	"fmt"
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

	NetworkLinkType        string `json:"networkLinkType,omitempty"`
	WifiSignalDBM          *int32 `json:"wifiSignalDbm,omitempty"`
	WifiLinkSpeedMbps      *int32 `json:"wifiLinkSpeedMbps,omitempty"`
	GatewayReachable       *bool  `json:"gatewayReachable,omitempty"`
	CaptivePortalSuspected *bool  `json:"captivePortalSuspected,omitempty"`
	LastDisconnectReason   string `json:"lastDisconnectReason,omitempty"`

	DisplayConnected   *bool    `json:"displayConnected,omitempty"`
	DisplayResolution  string   `json:"displayResolution,omitempty"`
	DisplayRefreshHz   *float32 `json:"displayRefreshHz,omitempty"`
	DisplayPowerState  string   `json:"displayPowerState,omitempty"`
	LastShutdownReason string   `json:"lastShutdownReason,omitempty"`
	PowerSource        string   `json:"powerSource,omitempty"`
	BatteryPercent     *int32   `json:"batteryPercent,omitempty"`

	ClockOffsetSeconds *int32 `json:"clockOffsetSeconds,omitempty"`
	TimeSyncState      string `json:"timeSyncState,omitempty"`

	StartupTotalMS       *int64 `json:"startupTotalMs,omitempty"`
	StartupConfigMS      *int64 `json:"startupConfigMs,omitempty"`
	StartupManifestMS    *int64 `json:"startupManifestMs,omitempty"`
	StartupAssetVerifyMS *int64 `json:"startupAssetVerifyMs,omitempty"`
	StartupFirstFrameMS  *int64 `json:"startupFirstFrameMs,omitempty"`

	VideoDecoderPath       string `json:"videoDecoderPath,omitempty"`
	VideoDecodedResolution string `json:"videoDecodedResolution,omitempty"`
}

type telemetryRollup struct {
	BucketStart            time.Time `json:"bucketStart"`
	Samples                int32     `json:"samples"`
	AverageRoundTripMS     *float32  `json:"averageRoundTripMs,omitempty"`
	MaxRoundTripMS         *int32    `json:"maxRoundTripMs,omitempty"`
	ConnectedSeconds       int32     `json:"connectedSeconds"`
	DisconnectedSeconds    int32     `json:"disconnectedSeconds"`
	HealthyPlaybackSeconds int32     `json:"healthyPlaybackSeconds"`
	StalledPlaybackSeconds int32     `json:"stalledPlaybackSeconds"`
	BlackOutputSeconds     int32     `json:"blackOutputSeconds"`
	DroppedFrames          int64     `json:"droppedFrames"`
	FrameChangeCount       int64     `json:"frameChangeCount"`
	DownloadedBytes        int64     `json:"downloadedBytes"`
	CacheHits              int64     `json:"cacheHits"`
	CacheMisses            int64     `json:"cacheMisses"`
	AverageMemoryBytes     *int64    `json:"averageMemoryBytes,omitempty"`
	PeakMemoryBytes        *int64    `json:"peakMemoryBytes,omitempty"`
	AverageCPUPercent      *float32  `json:"averageCpuPercent,omitempty"`
	// Decoded from thermalRaw after the scan, because the column is JSON.
	ThermalDistribution map[string]float64 `json:"thermalDistribution"`
	thermalRaw          []byte
	SyncDriftP50MS      *int32 `json:"syncDriftP50Ms,omitempty"`
	SyncDriftP95MS      *int32 `json:"syncDriftP95Ms,omitempty"`
	SyncDriftMaxMS      *int32 `json:"syncDriftMaxMs,omitempty"`

	HTTPRequestCount                int64  `json:"httpRequestCount"`
	HTTPFailureCount                int64  `json:"httpFailureCount"`
	HTTPClientErrorCount            int64  `json:"httpClientErrorCount"`
	HTTPServerErrorCount            int64  `json:"httpServerErrorCount"`
	RequestRetryCount               int64  `json:"requestRetryCount"`
	SocketReconnectCount            int64  `json:"socketReconnectCount"`
	NetworkInterfaceChangeCount     int64  `json:"networkInterfaceChangeCount"`
	DNSResolveP95MS                 *int32 `json:"dnsResolveP95Ms,omitempty"`
	TLSHandshakeP95MS               *int32 `json:"tlsHandshakeP95Ms,omitempty"`
	TimeToFirstByteP95MS            *int32 `json:"timeToFirstByteP95Ms,omitempty"`
	AverageThroughputBytesPerSecond *int64 `json:"averageThroughputBytesPerSecond,omitempty"`

	FrameTimeP95MS          *float32 `json:"frameTimeP95Ms,omitempty"`
	FrameTimeP99MS          *float32 `json:"frameTimeP99Ms,omitempty"`
	JankFrameCount          int64    `json:"jankFrameCount"`
	RendererCrashCount      int64    `json:"rendererCrashCount"`
	SurfaceLostCount        int64    `json:"surfaceLostCount"`
	DecoderInitFailureCount int64    `json:"decoderInitFailureCount"`

	CacheEvictionCount    int64 `json:"cacheEvictionCount"`
	CacheEvictedBytes     int64 `json:"cacheEvictedBytes"`
	IntegrityFailureCount int64 `json:"integrityFailureCount"`
	DownloadResumeCount   int64 `json:"downloadResumeCount"`
	DownloadFailureCount  int64 `json:"downloadFailureCount"`

	UnexpectedRebootCount int64 `json:"unexpectedRebootCount"`
	DisplaySleepCount     int64 `json:"displaySleepCount"`
	DisplayWakeCount      int64 `json:"displayWakeCount"`
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
	if err := s.db.QueryRow(r.Context(),
		fmt.Sprintf(`SELECT %s FROM screen_telemetry_snapshots WHERE screen_id=$1`, telemetryGaugeSelection),
		screenID).Scan(telemetryGaugeScanTargets(&snapshot)...); err == nil {
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

	rollupRows, err := s.db.Query(r.Context(), fmt.Sprintf(`
		SELECT bucket_start,samples,%s
		FROM screen_telemetry_rollups
		WHERE screen_id=$1 AND bucket_start>=$2 AND bucket_start<$3
		ORDER BY bucket_start DESC LIMIT 600`, telemetryRollupSelection),
		screenID, window.From, window.To)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rollupRows.Close()
	for rollupRows.Next() {
		var item telemetryRollup
		targets := append([]any{&item.BucketStart, &item.Samples}, telemetryRollupScanTargets(&item)...)
		if err := rollupRows.Scan(targets...); err != nil {
			s.internalError(w, r, err)
			return
		}
		item.ThermalDistribution = map[string]float64{}
		_ = json.Unmarshal(item.thermalRaw, &item.ThermalDistribution)
		response.Rollups = append(response.Rollups, item)
	}
	if err := rollupRows.Err(); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": response})
}
