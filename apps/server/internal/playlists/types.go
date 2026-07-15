package playlists

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound     = errors.New("playlist not found")
	ErrConflict     = errors.New("playlist conflict")
	ErrInvalidAsset = errors.New("asset is not ready for playback")
	ErrInvalidItem  = errors.New("playlist item is invalid")
)

type Playlist struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Revision    int64     `json:"revision"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Items       []Item    `json:"items"`
	ItemCount   int       `json:"itemCount"`
	Warnings    []string  `json:"warnings"`
}

type Item struct {
	ID                   uuid.UUID  `json:"id"`
	AssetID              uuid.UUID  `json:"assetId"`
	Position             int        `json:"position"`
	DurationMS           *int64     `json:"durationMs,omitempty"`
	FitMode              string     `json:"fitMode"`
	Transition           string     `json:"transition"`
	AudioEnabled         bool       `json:"audioEnabled"`
	Volume               float64    `json:"volume"`
	VideoStartOffsetMS   *int64     `json:"videoStartOffsetMs,omitempty"`
	VideoEndOffsetMS     *int64     `json:"videoEndOffsetMs,omitempty"`
	DeliveryPolicy       string     `json:"deliveryPolicy"`
	AssetName            string     `json:"assetName"`
	AssetType            string     `json:"assetType"`
	SourceProvider       string     `json:"sourceProvider,omitempty"`
	AssetStatus          string     `json:"assetStatus"`
	AssetDurationSeconds *float64   `json:"assetDurationSeconds,omitempty"`
	ThumbnailURL         string     `json:"thumbnailUrl"`
	VariantID            *uuid.UUID `json:"variantId,omitempty"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type ItemInput struct {
	AssetID            uuid.UUID `json:"assetId"`
	DurationMS         *int64    `json:"durationMs"`
	FitMode            string    `json:"fitMode"`
	Transition         string    `json:"transition"`
	AudioEnabled       *bool     `json:"audioEnabled"`
	Volume             *float64  `json:"volume"`
	VideoStartOffsetMS *int64    `json:"videoStartOffsetMs"`
	VideoEndOffsetMS   *int64    `json:"videoEndOffsetMs"`
	DeliveryPolicy     string    `json:"deliveryPolicy"`
}

type ListResult struct {
	Items    []Playlist `json:"items"`
	Total    int        `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"pageSize"`
}

type Assignment struct {
	ScreenID                      uuid.UUID            `json:"screenId"`
	PlaylistID                    *uuid.UUID           `json:"playlistId,omitempty"`
	PlaylistName                  *string              `json:"playlistName,omitempty"`
	PlaylistRevision              *int64               `json:"playlistRevision,omitempty"`
	ManifestVersion               int64                `json:"manifestVersion"`
	PlayerActiveManifestVersion   *int64               `json:"playerActiveManifestVersion,omitempty"`
	PlayerPendingManifestVersion  *int64               `json:"playerPendingManifestVersion,omitempty"`
	SynchronizationStatus         string               `json:"synchronizationStatus"`
	DownloadQueueCount            *int                 `json:"downloadQueueCount,omitempty"`
	DownloadedBytes               *int64               `json:"downloadedBytes,omitempty"`
	RequiredBytes                 *int64               `json:"requiredBytes,omitempty"`
	CacheUsedBytes                *int64               `json:"cacheUsedBytes,omitempty"`
	CacheLimitBytes               *int64               `json:"cacheLimitBytes,omitempty"`
	CurrentItemID                 *uuid.UUID           `json:"currentItemId,omitempty"`
	CurrentAssetID                *uuid.UUID           `json:"currentAssetId,omitempty"`
	PlaybackState                 *string              `json:"playbackState,omitempty"`
	LastSyncError                 *string              `json:"lastSynchronizationError,omitempty"`
	LastPlaybackError             *string              `json:"lastPlaybackError,omitempty"`
	CurrentScheduleID             *uuid.UUID           `json:"currentScheduleId,omitempty"`
	CurrentPlaylistID             *uuid.UUID           `json:"currentPlaylistId,omitempty"`
	SelectionSource               *string              `json:"selectionSource,omitempty"`
	NextTransitionAt              *time.Time           `json:"nextTransitionAt,omitempty"`
	DeviceClockOffsetSeconds      *int64               `json:"deviceClockOffsetSeconds,omitempty"`
	ScheduleEvaluationError       *string              `json:"scheduleEvaluationError,omitempty"`
	ScheduleManifestVersion       *int64               `json:"scheduleManifestVersion,omitempty"`
	Groups                        []AssignmentGroup    `json:"groups"`
	RelevantSchedules             []AssignmentSchedule `json:"relevantSchedules"`
	ClockSkewWarningSeconds       int                  `json:"clockSkewWarningSeconds"`
	CurrentWebsiteAssetID         *uuid.UUID           `json:"currentWebsiteAssetId,omitempty"`
	WebsiteState                  *string              `json:"websiteState,omitempty"`
	WebsiteLoadStartedAt          *time.Time           `json:"websiteLoadStartedAt,omitempty"`
	WebsiteLoadCompletedAt        *time.Time           `json:"websiteLoadCompletedAt,omitempty"`
	WebsiteFailureCategory        *string              `json:"websiteFailureCategory,omitempty"`
	WebsiteBlockedNavigationCount *int                 `json:"websiteBlockedNavigationCount,omitempty"`
	WebsiteCurrentHost            *string              `json:"websiteCurrentHost,omitempty"`
	WebsiteFallbackShown          *bool                `json:"websiteFallbackShown,omitempty"`
	WebsiteRendererRecoveryCount  *int                 `json:"websiteRendererRecoveryCount,omitempty"`
	ActiveEmergencyID             *uuid.UUID           `json:"activeEmergencyId,omitempty"`
	EmergencyState                *string              `json:"emergencyState,omitempty"`
	EmergencyPreparationProgress  *int                 `json:"emergencyPreparationProgress,omitempty"`
	PlaybackDisabled              bool                 `json:"playbackDisabled"`
	LastCommandID                 *uuid.UUID           `json:"lastCommandId,omitempty"`
	LastCommandState              *string              `json:"lastCommandState,omitempty"`
	LastCommandResult             *string              `json:"lastCommandResult,omitempty"`
	LastCommandCompletedAt        *time.Time           `json:"lastCommandCompletedAt,omitempty"`
	ActiveConfigRevision          *int64               `json:"activeConfigRevision,omitempty"`
	ConfigurationError            *string              `json:"configurationError,omitempty"`
}
type AssignmentGroup struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
type AssignmentSchedule struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	PlaylistName string    `json:"playlistName"`
	Priority     int       `json:"priority"`
	Enabled      bool      `json:"enabled"`
}

type Manifest struct {
	SchemaVersion          int                `json:"schemaVersion"`
	ManifestVersion        int64              `json:"manifestVersion"`
	ScreenID               uuid.UUID          `json:"screenId"`
	GeneratedAt            time.Time          `json:"generatedAt"`
	Mode                   string             `json:"mode"`
	Playlist               *ManifestPlaylist  `json:"playlist,omitempty"`
	DirectFallbackPlaylist *ManifestPlaylist  `json:"directFallbackPlaylist,omitempty"`
	Playlists              []ManifestPlaylist `json:"playlists"`
	Schedules              []ManifestSchedule `json:"schedules"`
	Assets                 []ManifestAsset    `json:"assets"`
	ServerTime             time.Time          `json:"serverTime"`
	PrefetchHorizonDays    int                `json:"prefetchHorizonDays"`
	ActivationGraceSeconds int                `json:"activationGraceSeconds"`
	Websites               []ManifestWebsite  `json:"websites"`
	Sources                []ManifestSource   `json:"sources"`
	Emergency              *ManifestEmergency `json:"emergency,omitempty"`
	SyncGroup              *ManifestSyncGroup `json:"syncGroup,omitempty"`
}
type ManifestSyncGroup struct {
	ID            uuid.UUID `json:"id"`
	PlaybackEpoch time.Time `json:"playbackEpoch"`
}
type ManifestSource struct {
	AssetID       uuid.UUID       `json:"assetId"`
	Name          string          `json:"name"`
	Provider      string          `json:"provider"`
	ConfigVersion int             `json:"configVersion"`
	Configuration json.RawMessage `json:"configuration"`
}
type ManifestEmergency struct {
	ID          uuid.UUID `json:"id"`
	PlaylistID  uuid.UUID `json:"playlistId"`
	ActivatedAt time.Time `json:"activatedAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
}
type ManifestWebsite struct {
	AssetID                uuid.UUID  `json:"assetId"`
	Name                   string     `json:"name"`
	URL                    string     `json:"url"`
	AllowedHosts           []string   `json:"allowedHosts"`
	JavaScriptEnabled      bool       `json:"javascriptEnabled"`
	DOMStorageEnabled      bool       `json:"domStorageEnabled"`
	CookiePolicy           string     `json:"cookiePolicy"`
	ReloadPolicy           string     `json:"reloadPolicy"`
	RefreshIntervalSeconds *int       `json:"refreshIntervalSeconds,omitempty"`
	LoadTimeoutSeconds     int        `json:"loadTimeoutSeconds"`
	ZoomPercent            int        `json:"zoomPercent"`
	ScrollX                int        `json:"scrollX"`
	ScrollY                int        `json:"scrollY"`
	CustomUserAgent        string     `json:"customUserAgent,omitempty"`
	BackgroundColor        string     `json:"backgroundColor"`
	FailureBehavior        string     `json:"failureBehavior"`
	FallbackImageAssetID   *uuid.UUID `json:"fallbackImageAssetId,omitempty"`
	FallbackVariantID      *uuid.UUID `json:"fallbackVariantId,omitempty"`
}
type ManifestSchedule struct {
	ID           uuid.UUID  `json:"id"`
	PlaylistID   uuid.UUID  `json:"playlistId"`
	Type         string     `json:"type"`
	Timezone     string     `json:"timezone"`
	Priority     int        `json:"priority"`
	Specificity  int        `json:"specificity"`
	StartDate    *string    `json:"startDate,omitempty"`
	EndDate      *string    `json:"endDate,omitempty"`
	OneTimeStart *time.Time `json:"oneTimeStart,omitempty"`
	OneTimeEnd   *time.Time `json:"oneTimeEnd,omitempty"`
	DailyStart   *string    `json:"dailyStart,omitempty"`
	DailyEnd     *string    `json:"dailyEnd,omitempty"`
	DaysOfWeek   []int      `json:"daysOfWeek,omitempty"`
}
type ManifestPlaylist struct {
	ID       uuid.UUID      `json:"id"`
	Revision int64          `json:"revision"`
	Name     string         `json:"name"`
	Items    []ManifestItem `json:"items"`
}
type ManifestItem struct {
	ID                 uuid.UUID  `json:"id"`
	AssetID            uuid.UUID  `json:"assetId"`
	VariantID          *uuid.UUID `json:"variantId,omitempty"`
	AssetType          string     `json:"assetType"`
	DurationMS         *int64     `json:"durationMs,omitempty"`
	FitMode            string     `json:"fitMode"`
	Transition         string     `json:"transition"`
	AudioEnabled       bool       `json:"audioEnabled"`
	Volume             float64    `json:"volume"`
	VideoStartOffsetMS *int64     `json:"videoStartOffsetMs,omitempty"`
	VideoEndOffsetMS   *int64     `json:"videoEndOffsetMs,omitempty"`
	DeliveryPolicy     string     `json:"deliveryPolicy"`
}
type ManifestAsset struct {
	AssetID         uuid.UUID `json:"assetId"`
	VariantID       uuid.UUID `json:"variantId"`
	MIMEType        string    `json:"mimeType"`
	SHA256          string    `json:"sha256"`
	FileSize        int64     `json:"fileSize"`
	Width           *int      `json:"width,omitempty"`
	Height          *int      `json:"height,omitempty"`
	DurationSeconds *float64  `json:"durationSeconds,omitempty"`
	DownloadPath    string    `json:"downloadPath"`
}

type PlayerStatus struct {
	ActiveManifestVersion         *int64     `json:"activeManifestVersion,omitempty"`
	PendingManifestVersion        *int64     `json:"pendingManifestVersion,omitempty"`
	AssignedPlaylistID            *uuid.UUID `json:"assignedPlaylistId,omitempty"`
	CurrentItemID                 *uuid.UUID `json:"currentItemId,omitempty"`
	CurrentAssetID                *uuid.UUID `json:"currentAssetId,omitempty"`
	PlaybackState                 string     `json:"playbackState,omitempty"`
	DownloadQueueCount            *int       `json:"downloadQueueCount,omitempty"`
	DownloadedBytes               *int64     `json:"downloadedBytes,omitempty"`
	RequiredBytes                 *int64     `json:"requiredBytes,omitempty"`
	CacheUsedBytes                *int64     `json:"cacheUsedBytes,omitempty"`
	CacheLimitBytes               *int64     `json:"cacheLimitBytes,omitempty"`
	LastSyncError                 string     `json:"lastSynchronizationError,omitempty"`
	LastPlaybackError             string     `json:"lastPlaybackError,omitempty"`
	CurrentScheduleID             *uuid.UUID `json:"currentScheduleId,omitempty"`
	CurrentPlaylistID             *uuid.UUID `json:"currentPlaylistId,omitempty"`
	SelectionSource               string     `json:"selectionSource,omitempty"`
	NextTransitionAt              *time.Time `json:"nextTransitionAt,omitempty"`
	DeviceClockOffsetSeconds      *int64     `json:"deviceClockOffsetSeconds,omitempty"`
	ScheduleEvaluationError       string     `json:"scheduleEvaluationError,omitempty"`
	ScheduleManifestVersion       *int64     `json:"scheduleManifestVersion,omitempty"`
	CurrentWebsiteAssetID         *uuid.UUID `json:"currentWebsiteAssetId,omitempty"`
	WebsiteState                  string     `json:"websiteState,omitempty"`
	WebsiteLoadStartedAt          *time.Time `json:"websiteLoadStartedAt,omitempty"`
	WebsiteLoadCompletedAt        *time.Time `json:"websiteLoadCompletedAt,omitempty"`
	WebsiteFailureCategory        string     `json:"websiteFailureCategory,omitempty"`
	WebsiteBlockedNavigationCount *int       `json:"websiteBlockedNavigationCount,omitempty"`
	WebsiteCurrentHost            string     `json:"websiteCurrentHost,omitempty"`
	WebsiteFallbackShown          *bool      `json:"websiteFallbackShown,omitempty"`
	WebsiteRendererRecoveryCount  *int       `json:"websiteRendererRecoveryCount,omitempty"`
	CurrentSourceID               *uuid.UUID `json:"currentSourceId,omitempty"`
	SourceProvider                string     `json:"sourceProvider,omitempty"`
	SourceState                   string     `json:"sourceState,omitempty"`
	SourceError                   string     `json:"sourceError,omitempty"`
	ActiveEmergencyID             *uuid.UUID `json:"activeEmergencyId,omitempty"`
	EmergencyState                string     `json:"emergencyState,omitempty"`
	EmergencyPreparationProgress  *int       `json:"emergencyPreparationProgress,omitempty"`
	PlaybackDisabled              *bool      `json:"playbackDisabled,omitempty"`
	LastCommandID                 *uuid.UUID `json:"lastCommandId,omitempty"`
	LastCommandState              string     `json:"lastCommandState,omitempty"`
	LastCommandResult             string     `json:"lastCommandResult,omitempty"`
	LastCommandCompletedAt        *time.Time `json:"lastCommandCompletedAt,omitempty"`
	ActiveConfigRevision          *int64     `json:"activeConfigRevision,omitempty"`
	ConfigurationError            string     `json:"configurationError,omitempty"`
}

type Notifier interface {
	ManifestChanged(screenID uuid.UUID, version int64)
}
