package media

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

type AssetStatus string

const (
	StatusUploading  AssetStatus = "uploading"
	StatusUploaded   AssetStatus = "uploaded"
	StatusQueued     AssetStatus = "queued"
	StatusInspecting AssetStatus = "inspecting"
	StatusProcessing AssetStatus = "processing"
	StatusReady      AssetStatus = "ready"
	StatusFailed     AssetStatus = "failed"
	StatusDeleting   AssetStatus = "deleting"
	StatusDeleted    AssetStatus = "deleted"
)

var assetTransitions = map[AssetStatus]map[AssetStatus]bool{
	StatusUploading:  {StatusUploaded: true, StatusFailed: true},
	StatusUploaded:   {StatusQueued: true, StatusFailed: true, StatusDeleting: true},
	StatusQueued:     {StatusInspecting: true, StatusProcessing: true, StatusFailed: true, StatusDeleting: true},
	StatusInspecting: {StatusProcessing: true, StatusReady: true, StatusFailed: true, StatusDeleting: true},
	StatusProcessing: {StatusReady: true, StatusFailed: true, StatusDeleting: true},
	StatusReady:      {StatusDeleting: true},
	StatusFailed:     {StatusQueued: true, StatusDeleting: true},
	StatusDeleting:   {StatusDeleted: true, StatusFailed: true},
}

func CanTransitionAsset(from, to AssetStatus) bool { return assetTransitions[from][to] }

type UploadStatus string

const (
	UploadPending    UploadStatus = "pending"
	UploadUploading  UploadStatus = "uploading"
	UploadFinalizing UploadStatus = "finalizing"
	UploadFinalized  UploadStatus = "finalized"
	UploadFailed     UploadStatus = "failed"
	UploadExpired    UploadStatus = "expired"
	UploadCancelled  UploadStatus = "cancelled"
)

var uploadTransitions = map[UploadStatus]map[UploadStatus]bool{
	UploadPending:    {UploadUploading: true, UploadFinalizing: true, UploadCancelled: true, UploadExpired: true, UploadFailed: true},
	UploadUploading:  {UploadUploading: true, UploadFinalizing: true, UploadCancelled: true, UploadExpired: true, UploadFailed: true},
	UploadFinalizing: {UploadFinalized: true, UploadFailed: true},
}

func CanTransitionUpload(from, to UploadStatus) bool { return uploadTransitions[from][to] }

var (
	ErrNotFound           = errors.New("media resource not found")
	ErrForbidden          = errors.New("media action forbidden")
	ErrUploadTooLarge     = errors.New("upload too large")
	ErrOffsetMismatch     = errors.New("upload offset mismatch")
	ErrUploadIncomplete   = errors.New("upload incomplete")
	ErrUploadExpired      = errors.New("upload expired")
	ErrUploadUnavailable  = errors.New("upload unavailable")
	ErrInsufficientSpace  = errors.New("insufficient storage")
	ErrUnsupportedType    = errors.New("unsupported media type")
	ErrInspectionFailed   = errors.New("media inspection failed")
	ErrNotReady           = errors.New("media not ready")
	ErrVariantUnavailable = errors.New("media variant unavailable")
)

type Asset struct {
	ID                 uuid.UUID      `json:"id"`
	Name               string         `json:"name"`
	Description        string         `json:"description"`
	Type               string         `json:"type"`
	OriginalFilename   string         `json:"originalFilename"`
	DeclaredMIMEType   string         `json:"declaredMimeType"`
	DetectedMIMEType   string         `json:"detectedMimeType"`
	SHA256             string         `json:"sha256"`
	OriginalSize       int64          `json:"originalSize"`
	Width              *int           `json:"width,omitempty"`
	Height             *int           `json:"height,omitempty"`
	Duration           *float64       `json:"durationSeconds,omitempty"`
	FrameRate          *float64       `json:"frameRate,omitempty"`
	VideoCodec         *string        `json:"videoCodec,omitempty"`
	AudioCodec         *string        `json:"audioCodec,omitempty"`
	AudioChannels      *int           `json:"audioChannels,omitempty"`
	Metadata           map[string]any `json:"metadata"`
	ProcessingStatus   AssetStatus    `json:"processingStatus"`
	ProcessingProgress *float64       `json:"processingProgress,omitempty"`
	ErrorCode          *string        `json:"errorCode,omitempty"`
	ErrorMessage       *string        `json:"errorMessage,omitempty"`
	Creator            *Creator       `json:"creator,omitempty"`
	CreatedAt          time.Time      `json:"createdAt"`
	UpdatedAt          time.Time      `json:"updatedAt"`
	Variants           []Variant      `json:"variants"`
	ThumbnailURL       *string        `json:"thumbnailUrl,omitempty"`
	Website            *WebsiteConfig `json:"website,omitempty"`
	Source             *Source        `json:"source,omitempty"`
	PlaylistUsage      int            `json:"playlistUsage"`
}

type Source struct {
	Provider      string          `json:"provider"`
	ConfigVersion int             `json:"configVersion"`
	Configuration json.RawMessage `json:"configuration"`
}

type SourceInput struct {
	Provider      string          `json:"provider"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	Configuration json.RawMessage `json:"configuration"`
}

type YouTubeConfig struct {
	URL                  string     `json:"url"`
	Kind                 string     `json:"kind"`
	VideoID              string     `json:"videoId,omitempty"`
	PlaylistID           string     `json:"playlistId,omitempty"`
	StartSeconds         int        `json:"startSeconds"`
	EndSeconds           *int       `json:"endSeconds,omitempty"`
	Loop                 bool       `json:"loop"`
	Muted                bool       `json:"muted"`
	Volume               int        `json:"volume"`
	Captions             bool       `json:"captions"`
	CaptionLanguage      string     `json:"captionLanguage,omitempty"`
	Controls             bool       `json:"controls"`
	FailureBehavior      string     `json:"failureBehavior"`
	FallbackImageAssetID *uuid.UUID `json:"fallbackImageAssetId,omitempty"`
	PlaylistPlaybackMode string     `json:"playlistPlaybackMode"`
	FixedDurationSeconds *int       `json:"fixedDurationSeconds,omitempty"`
}

type WebsiteConfig struct {
	URL                    string     `json:"url"`
	DisplayURL             string     `json:"displayUrl"`
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
	CustomUserAgent        string     `json:"customUserAgent"`
	BackgroundColor        string     `json:"backgroundColor"`
	FailureBehavior        string     `json:"failureBehavior"`
	FallbackImageAssetID   *uuid.UUID `json:"fallbackImageAssetId,omitempty"`
	CreatedAt              time.Time  `json:"createdAt"`
	UpdatedAt              time.Time  `json:"updatedAt"`
}

type WebsiteInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	WebsiteConfig
	javascriptSet bool
	domStorageSet bool
}

type WebsiteDiagnostics struct {
	AssetID              uuid.UUID                `json:"assetId"`
	ConfiguredURL        string                   `json:"configuredUrl"`
	AllowedHosts         []string                 `json:"allowedHosts"`
	LastSuccessfulLoad   *time.Time               `json:"lastSuccessfulLoad,omitempty"`
	LastFailure          *time.Time               `json:"lastFailure,omitempty"`
	LastFailureCategory  *string                  `json:"lastFailureCategory,omitempty"`
	ReportingScreens     []WebsiteReportingScreen `json:"reportingScreens"`
	FallbackImageAssetID *uuid.UUID               `json:"fallbackImageAssetId,omitempty"`
}
type WebsiteReportingScreen struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	State string    `json:"state"`
	Host  *string   `json:"host,omitempty"`
}

type AssetInvalidator interface {
	AssetChanged(context.Context, uuid.UUID, string) error
}

type Creator struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type Variant struct {
	ID               uuid.UUID `json:"id"`
	Kind             string    `json:"kind"`
	MIMEType         string    `json:"mimeType"`
	FileSize         int64     `json:"fileSize"`
	SHA256           string    `json:"sha256"`
	Width            *int      `json:"width,omitempty"`
	Height           *int      `json:"height,omitempty"`
	Duration         *float64  `json:"durationSeconds,omitempty"`
	FrameRate        *float64  `json:"frameRate,omitempty"`
	VideoCodec       *string   `json:"videoCodec,omitempty"`
	AudioCodec       *string   `json:"audioCodec,omitempty"`
	PlayerCompatible bool      `json:"playerCompatible"`
	CreatedAt        time.Time `json:"createdAt"`
}

type Upload struct {
	ID               uuid.UUID    `json:"id"`
	OriginalFilename string       `json:"filename"`
	DeclaredMIMEType string       `json:"mimeType"`
	ExpectedSize     int64        `json:"sizeBytes"`
	CurrentOffset    int64        `json:"offset"`
	Status           UploadStatus `json:"status"`
	ExpiresAt        time.Time    `json:"expiresAt"`
	ResultingAssetID *uuid.UUID   `json:"assetId,omitempty"`
	UploadEndpoint   string       `json:"uploadEndpoint"`
	MaximumSize      int64        `json:"maximumSizeBytes"`
}

type ListOptions struct {
	Search, Type, SourceProvider, Status, Sort string
	Page, PageSize                             int
}
type ListResult struct {
	Items    []Asset `json:"items"`
	Total    int     `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"pageSize"`
}

type Delivery struct {
	AssetID   uuid.UUID
	VariantID uuid.UUID
	Path      string
	MIMEType  string
	Size      int64
	HashHex   string
}
