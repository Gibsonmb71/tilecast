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
	ID                   uuid.UUID  `json:"id"`
	StartedAt            time.Time  `json:"startedAt"`
	EndedAt              *time.Time `json:"endedAt,omitempty"`
	ScreenID             uuid.UUID  `json:"screenId"`
	ScreenName           string     `json:"screenName"`
	GroupID              *uuid.UUID `json:"groupId,omitempty"`
	GroupName            string     `json:"groupName,omitempty"`
	PresentationType     string     `json:"presentationType,omitempty"`
	PresentationID       string     `json:"presentationId,omitempty"`
	PresentationRevision string     `json:"presentationRevision,omitempty"`
	PresentationName     string     `json:"presentationName,omitempty"`
	ContentType          string     `json:"contentType,omitempty"`
	ContentID            string     `json:"contentId,omitempty"`
	ContentName          string     `json:"contentName,omitempty"`
	PlaylistItemID       string     `json:"playlistItemId,omitempty"`
	LayoutPlacementID    string     `json:"layoutPlacementId,omitempty"`
	ActualDurationMS     *int64     `json:"actualDurationMs,omitempty"`
	ExpectedDurationMS   *int64     `json:"expectedDurationMs,omitempty"`
	Result               string     `json:"result"`
	Trigger              string     `json:"trigger,omitempty"`
	ScheduleID           string     `json:"scheduleId,omitempty"`
	EmergencyID          string     `json:"emergencyId,omitempty"`
	ManifestVersion      *int64     `json:"manifestVersion,omitempty"`
	FailureCode          string     `json:"failureCode,omitempty"`
	SourceID             string     `json:"sourceId,omitempty"`
	SelectedRecordID     string     `json:"selectedRecordId,omitempty"`
	SelectionDate        *time.Time `json:"selectionDate,omitempty"`
	SourceCachedAt       *time.Time `json:"sourceCachedAt,omitempty"`
	SourceRevision       string     `json:"sourceRevision,omitempty"`
	SnapshotHash         string     `json:"snapshotHash,omitempty"`
	// Whether this row is the screen's root presentation interval or the
	// content shown inside it. Only root rows are screen wall-clock time.
	SessionType    string         `json:"sessionType"`
	TerminalReason string         `json:"terminalReason,omitempty"`
	Details        map[string]any `json:"details"`
}

type proofOfPlayPage struct {
	Items      []proofOfPlayRecord `json:"items"`
	NextCursor string              `json:"nextCursor,omitempty"`
}

type proofSummaryItem struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// Wall-clock screen time for this group: the union of its root
	// presentation intervals, so overlapping zones are not double-counted.
	ConfirmedScreenPlaybackMS int64 `json:"confirmedScreenPlaybackMs"`
	ContentExposureMS         int64 `json:"contentExposureMs"`
	Records                   int64 `json:"records"`
	Completed                 int64 `json:"completed"`
	Failures                  int64 `json:"failures"`
	Partial                   int64 `json:"partial"`
	Unknown                   int64 `json:"unknown"`
	Interrupted               int64 `json:"interrupted"`
	// The share of sessions that completed or ran partially. This is a session
	// outcome rate, not scheduled-playback coverage: nothing here compares
	// actual playback against what was supposed to play.
	SessionCompletionPercent float64 `json:"sessionCompletionPercent"`
}

type activityOverviewData struct {
	Range struct {
		From time.Time `json:"from"`
		To   time.Time `json:"to"`
	} `json:"range"`
	Cards struct {
		ScreensWithReportingGaps int64 `json:"screensWithReportingGaps"`
		// Wall-clock screen time: the union of root presentation intervals.
		ConfirmedScreenPlaybackMS int64 `json:"confirmedScreenPlaybackMs"`
		// Sum of child content intervals, which may exceed wall clock when
		// several layout zones play at once.
		ContentExposureMS int64 `json:"contentExposureMs"`
		PlaybackFailures  int64 `json:"playbackFailures"`
		// Only sessions that ended for an unexpected reason. A schedule change
		// or a normal item boundary is not an interruption.
		InterruptedPlays     int64 `json:"interruptedPlays"`
		EmergencyActivations int64 `json:"emergencyActivations"`
		FailedPlayerUpdates  int64 `json:"failedPlayerUpdates"`
		RecentAdminChanges   int64 `json:"recentAdministrativeChanges"`
	} `json:"cards"`
	// Fleet health is measured now, not over the selected range, because it
	// answers what is on screen at this moment.
	Fleet activityFleetHealth `json:"fleet"`
	// Unresolved problems live in the incident model, not in a list rebuilt
	// from whichever bad event happened to be latest.
	Timeline []activityTimelineItem `json:"timeline"`
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
