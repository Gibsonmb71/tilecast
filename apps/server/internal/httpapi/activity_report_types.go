package httpapi

import (
	"time"

	"github.com/google/uuid"
)

type screenEventRecord struct {
	ID              uuid.UUID      `json:"id"`
	Timestamp       time.Time      `json:"timestamp"`
	ReceivedAt      time.Time      `json:"receivedAt"`
	ScreenID        uuid.UUID      `json:"screenId"`
	ScreenName      string         `json:"screenName"`
	GroupID         *uuid.UUID     `json:"groupId,omitempty"`
	GroupName       string         `json:"groupName,omitempty"`
	Sequence        *int64         `json:"sequence"`
	EventType       string         `json:"eventType"`
	Category        string         `json:"category"`
	Severity        string         `json:"severity"`
	Description     string         `json:"description"`
	RelatedType     string         `json:"relatedType,omitempty"`
	RelatedID       string         `json:"relatedId,omitempty"`
	Result          string         `json:"result"`
	ManifestVersion *int64         `json:"manifestVersion,omitempty"`
	FailureCode     string         `json:"failureCode,omitempty"`
	FailureMessage  string         `json:"failureMessage,omitempty"`
	Details         map[string]any `json:"details"`
}

type screenEventPage struct {
	Items      []screenEventRecord `json:"items"`
	NextCursor string              `json:"nextCursor,omitempty"`
}

type proofOfPlayRecord struct {
	ID                   uuid.UUID      `json:"id"`
	StartedAt            time.Time      `json:"startedAt"`
	EndedAt              *time.Time     `json:"endedAt,omitempty"`
	ScreenID             uuid.UUID      `json:"screenId"`
	ScreenName           string         `json:"screenName"`
	GroupID              *uuid.UUID     `json:"groupId,omitempty"`
	GroupName            string         `json:"groupName,omitempty"`
	PresentationType     string         `json:"presentationType,omitempty"`
	PresentationID       string         `json:"presentationId,omitempty"`
	PresentationRevision string         `json:"presentationRevision,omitempty"`
	PresentationName     string         `json:"presentationName,omitempty"`
	ContentType          string         `json:"contentType,omitempty"`
	ContentID            string         `json:"contentId,omitempty"`
	ContentName          string         `json:"contentName,omitempty"`
	PlaylistItemID       string         `json:"playlistItemId,omitempty"`
	LayoutPlacementID    string         `json:"layoutPlacementId,omitempty"`
	ActualDurationMS     *int64         `json:"actualDurationMs,omitempty"`
	ExpectedDurationMS   *int64         `json:"expectedDurationMs,omitempty"`
	Result               string         `json:"result"`
	Trigger              string         `json:"trigger,omitempty"`
	ScheduleID           string         `json:"scheduleId,omitempty"`
	EmergencyID          string         `json:"emergencyId,omitempty"`
	ManifestVersion      *int64         `json:"manifestVersion,omitempty"`
	FailureCode          string         `json:"failureCode,omitempty"`
	SourceID             string         `json:"sourceId,omitempty"`
	SelectedRecordID     string         `json:"selectedRecordId,omitempty"`
	SelectionDate        *time.Time     `json:"selectionDate,omitempty"`
	SourceCachedAt       *time.Time     `json:"sourceCachedAt,omitempty"`
	SourceRevision       string         `json:"sourceRevision,omitempty"`
	SnapshotHash         string         `json:"snapshotHash,omitempty"`
	Details              map[string]any `json:"details"`
}

type proofOfPlayPage struct {
	Items      []proofOfPlayRecord `json:"items"`
	NextCursor string              `json:"nextCursor,omitempty"`
}

type proofSummaryItem struct {
	Key                 string  `json:"key"`
	Label               string  `json:"label"`
	ConfirmedDurationMS int64   `json:"confirmedDurationMs"`
	Records             int64   `json:"records"`
	Completed           int64   `json:"completed"`
	Failures            int64   `json:"failures"`
	Partial             int64   `json:"partial"`
	Unknown             int64   `json:"unknown"`
	CoveragePercent     float64 `json:"coveragePercent"`
}

type activityOverviewData struct {
	Range struct {
		From time.Time `json:"from"`
		To   time.Time `json:"to"`
	} `json:"range"`
	Cards struct {
		ScreensReportingNormally int64 `json:"screensReportingNormally"`
		ScreensWithPlaybackGaps  int64 `json:"screensWithPlaybackGaps"`
		ConfirmedDurationMS      int64 `json:"confirmedPlaybackDurationMs"`
		PlaybackFailures         int64 `json:"playbackFailures"`
		InterruptedPlays         int64 `json:"interruptedPlays"`
		EmergencyActivations     int64 `json:"emergencyActivations"`
		FailedPlayerUpdates      int64 `json:"failedPlayerUpdates"`
		RecentAdminChanges       int64 `json:"recentAdministrativeChanges"`
	} `json:"cards"`
	NeedsAttention []activityAttentionItem `json:"needsAttention"`
	Timeline       []activityTimelineItem  `json:"timeline"`
}

type activityAttentionItem struct {
	ScreenID    uuid.UUID `json:"screenId"`
	ScreenName  string    `json:"screenName"`
	Kind        string    `json:"kind"`
	Severity    string    `json:"severity"`
	Description string    `json:"description"`
	OccurredAt  time.Time `json:"occurredAt"`
}

type activityTimelineItem struct {
	ID          string     `json:"id"`
	Timestamp   time.Time  `json:"timestamp"`
	Domain      string     `json:"domain"`
	Severity    string     `json:"severity"`
	Description string     `json:"description"`
	ScreenID    *uuid.UUID `json:"screenId,omitempty"`
	ResourceID  string     `json:"resourceId,omitempty"`
}

type uptimeReport struct {
	Range struct {
		From time.Time `json:"from"`
		To   time.Time `json:"to"`
	} `json:"range"`
	Window                string               `json:"window"`
	WindowLabel           string               `json:"windowLabel"`
	BucketSeconds         int64                `json:"bucketSeconds"`
	ScreensTracked        int                  `json:"screensTracked"`
	ScreensWithDowntime   int                  `json:"screensWithDowntime"`
	ScreensUnmeasured     int                  `json:"screensUnmeasured"`
	TrackedSeconds        int64                `json:"trackedSeconds"`
	UpSeconds             int64                `json:"upSeconds"`
	ImpairedSeconds       int64                `json:"impairedSeconds"`
	DownSeconds           int64                `json:"downSeconds"`
	UptimePercent         *float64             `json:"uptimePercent"`
	PreviousUptimePercent *float64             `json:"previousUptimePercent"`
	Buckets               []uptimeBucket       `json:"buckets"`
	Screens               []uptimeScreenUptime `json:"screens"`
}

type uptimeBucket struct {
	Start           time.Time `json:"start"`
	UpPercent       float64   `json:"upPercent"`
	ImpairedPercent float64   `json:"impairedPercent"`
	DownPercent     float64   `json:"downPercent"`
	UnknownPercent  float64   `json:"unknownPercent"`
	UptimePercent   *float64  `json:"uptimePercent"`
	ScreensDown     int       `json:"screensDown"`
}

type uptimeScreenUptime struct {
	ScreenID        uuid.UUID `json:"screenId"`
	ScreenName      string    `json:"screenName"`
	UptimePercent   *float64  `json:"uptimePercent"`
	TrackedSeconds  int64     `json:"trackedSeconds"`
	UpSeconds       int64     `json:"upSeconds"`
	ImpairedSeconds int64     `json:"impairedSeconds"`
	DownSeconds     int64     `json:"downSeconds"`
	Buckets         []string  `json:"buckets"`
}

type screenActivityData struct {
	ScreenID                         uuid.UUID              `json:"screenId"`
	CurrentPresentation              *proofOfPlayRecord     `json:"currentPresentation,omitempty"`
	RecentProof                      []proofOfPlayRecord    `json:"recentProofOfPlay"`
	RecentEvents                     []screenEventRecord    `json:"recentEvents"`
	PlaybackGaps                     int64                  `json:"playbackGaps"`
	LastHealthyPlayback              *time.Time             `json:"lastHealthyPlayback,omitempty"`
	LastSuccessfulManifestActivation *time.Time             `json:"lastSuccessfulManifestActivation,omitempty"`
	CurrentIssue                     *activityAttentionItem `json:"currentIssue,omitempty"`
}
