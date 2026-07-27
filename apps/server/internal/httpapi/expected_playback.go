package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Expected playback is what should have been on a screen, recorded when the
// selection became effective. It is deliberately not reconstructed from
// current configuration: schedules and assignments change, and reporting last
// month against this month's plan would measure compliance with a plan that
// never existed then.

const (
	matchConfirmed         = "confirmed"
	matchStartedLate       = "started_late"
	matchEndedEarly        = "ended_early"
	matchPartial           = "partial"
	matchFailed            = "failed"
	matchNeverStarted      = "never_started"
	matchScreenOffline     = "screen_offline"
	matchEmergencyOverride = "overridden_by_emergency"
	matchCancelled         = "cancelled"
	matchNotMeasurable     = "not_measurable"
)

// Slack on each edge. A player that starts two seconds after the window opens
// did what was asked; calling that a late start would make compliance a
// measure of clock skew.
const (
	expectedStartGrace = 90 * time.Second
	expectedEndGrace   = 90 * time.Second
	// Below this length a window cannot be judged fairly — it is shorter than
	// the reporting grace itself.
	expectedMinimumMeasurable = 2 * time.Minute
)

// Reasons that end a window without it counting as missed playback. Each one
// means normal playback was not supposed to happen, so scoring it as a miss
// would penalise the operator for their own decision.
var expectedCancellingReasons = map[string]bool{
	"screen_disabled":                true,
	"active_hours_changed":           true,
	"deployment_suppressed_playback": true,
	"screen_archived":                true,
}

type expectedWindowInput struct {
	ScreenID         uuid.UUID
	PresentationType string
	PresentationID   string
	PresentationRev  string
	ManifestVersion  *int64
	ScheduleID       string
	TriggerSource    string
	Timezone         string
	EmergencyID      *uuid.UUID
	ContentType      string
	ContentID        string
}

// openExpectedWindow supersedes whatever was expected before and records what
// is expected from now on. Called when a selection becomes effective, so the
// expectation is written at the moment it becomes true rather than inferred
// later.
func openExpectedWindow(ctx context.Context, tx pgx.Tx, at time.Time, reason string, input expectedWindowInput) error {
	if err := supersedeExpectedWindows(ctx, tx, input.ScreenID, at, reason); err != nil {
		return err
	}
	if input.TriggerSource == "" {
		input.TriggerSource = "direct"
	}
	if input.Timezone == "" {
		input.Timezone = "UTC"
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO expected_playback_windows(
			id,screen_id,presentation_type,presentation_id,presentation_revision,manifest_version,
			schedule_id,trigger_source,expected_start,timezone,overridden_by_emergency_id,
			expected_content_type,expected_content_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		uuid.New(), input.ScreenID, input.PresentationType, input.PresentationID, input.PresentationRev,
		input.ManifestVersion, input.ScheduleID, input.TriggerSource, at, input.Timezone,
		input.EmergencyID, input.ContentType, input.ContentID)
	return err
}

// supersedeExpectedWindows closes the open window for a screen. The window is
// never edited: closing it preserves exactly what was expected, and the reason
// is what later decides whether the unplayed time was a miss.
func supersedeExpectedWindows(ctx context.Context, tx pgx.Tx, screenID uuid.UUID, at time.Time, reason string) error {
	_, err := tx.Exec(ctx, `
		UPDATE expected_playback_windows
		SET expected_end=GREATEST(expected_start,$2),superseded_at=$2,superseded_reason=$3
		WHERE screen_id=$1 AND superseded_at IS NULL AND expected_end IS NULL`,
		screenID, at, reason)
	return err
}

// evaluateExpectedWindows matches root playback against every closed window
// that has not been judged yet. Open windows are left alone: a window still in
// force has not finished, and judging it early would report a screen as having
// missed playback that is still running.
func (s *server) evaluateExpectedWindows(ctx context.Context, screenID *uuid.UUID) error {
	clause, args := "", []any{time.Now().UTC()}
	if screenID != nil {
		clause = " AND w.screen_id=$2"
		args = append(args, *screenID)
	}
	rows, err := s.db.Query(ctx, `
		SELECT w.id,w.screen_id,w.expected_start,w.expected_end,w.superseded_reason,
		       w.overridden_by_emergency_id,w.trigger_source
		FROM expected_playback_windows w
		WHERE w.expected_end IS NOT NULL AND w.expected_end <= $1
		  AND (w.match_evaluated_at IS NULL OR w.match_evaluated_at < w.expected_end)`+clause+`
		ORDER BY w.expected_start LIMIT 2000`, args...)
	if err != nil {
		return err
	}
	type pending struct {
		ID          uuid.UUID
		ScreenID    uuid.UUID
		Start, End  time.Time
		Reason      *string
		EmergencyID *uuid.UUID
		Trigger     string
	}
	windows := []pending{}
	for rows.Next() {
		var item pending
		if rows.Scan(&item.ID, &item.ScreenID, &item.Start, &item.End, &item.Reason,
			&item.EmergencyID, &item.Trigger) == nil {
			windows = append(windows, item)
		}
	}
	rows.Close()

	for _, window := range windows {
		status, confirmed, actualStart, actualEnd, sessionID := s.matchExpectedWindow(ctx, window.ScreenID,
			window.Start, window.End, window.Reason, window.EmergencyID)
		if _, err := s.db.Exec(ctx, `
			UPDATE expected_playback_windows
			SET match_status=$2,confirmed_duration_ms=$3,actual_start=$4,actual_end=$5,
			    matched_session_id=$6,match_evaluated_at=now()
			WHERE id=$1`,
			window.ID, status, confirmed, actualStart, actualEnd, sessionID); err != nil {
			return err
		}
	}
	return nil
}

// matchExpectedWindow decides what actually happened during one window.
func (s *server) matchExpectedWindow(
	ctx context.Context, screenID uuid.UUID, start, end time.Time,
	reason *string, emergencyID *uuid.UUID,
) (string, int64, *time.Time, *time.Time, *uuid.UUID) {
	// An emergency replaced normal playback on purpose; that time is not a
	// missed normal play and is excluded from the compliance denominator.
	if emergencyID != nil {
		return matchEmergencyOverride, 0, nil, nil, nil
	}
	if reason != nil && expectedCancellingReasons[*reason] {
		return matchCancelled, 0, nil, nil, nil
	}
	if end.Sub(start) < expectedMinimumMeasurable {
		return matchNotMeasurable, 0, nil, nil, nil
	}

	var confirmed int64
	var actualStart, actualEnd *time.Time
	var sessionID *uuid.UUID
	var failed bool
	// Root sessions only: child content is exposure inside the presentation,
	// not the screen's wall clock, so counting it would inflate compliance.
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(p.ended_at,$3),$3) - GREATEST(p.started_at,$2))))*1000,0)::bigint,
		       MIN(GREATEST(p.started_at,$2)),MAX(LEAST(COALESCE(p.ended_at,$3),$3)),
		       (array_agg(p.id ORDER BY p.started_at))[1],
		       bool_or(p.result='failed')
		FROM playback_sessions p
		WHERE p.screen_id=$1 AND p.session_type='presentation'
		  AND p.started_at<$3 AND COALESCE(p.ended_at,$3)>$2
		  AND p.result IN('playing','completed','recovered','partial','failed')`,
		screenID, start, end).Scan(&confirmed, &actualStart, &actualEnd, &sessionID, &failed)

	if confirmed <= 0 {
		// Nothing played. Whether that is the screen's fault depends on
		// whether it was reachable, which is a different operational problem
		// from a player that was up and showing nothing.
		if s.screenWasOffline(ctx, screenID, start, end) {
			return matchScreenOffline, 0, nil, nil, nil
		}
		return matchNeverStarted, 0, nil, nil, nil
	}

	expected := end.Sub(start).Milliseconds()
	late := actualStart != nil && actualStart.Sub(start) > expectedStartGrace
	early := actualEnd != nil && end.Sub(*actualEnd) > expectedEndGrace
	switch {
	case failed:
		return matchFailed, confirmed, actualStart, actualEnd, sessionID
	case late && early:
		// Both ends missing is not a late start or an early end; it is a
		// window that was only partly covered.
		return matchPartial, confirmed, actualStart, actualEnd, sessionID
	case late:
		return matchStartedLate, confirmed, actualStart, actualEnd, sessionID
	case early:
		return matchEndedEarly, confirmed, actualStart, actualEnd, sessionID
	case confirmed*100 < expected*95:
		// Covered at both ends but with a hole in the middle.
		return matchPartial, confirmed, actualStart, actualEnd, sessionID
	default:
		return matchConfirmed, confirmed, actualStart, actualEnd, sessionID
	}
}

// screenWasOffline reports whether the screen was unreachable for most of the
// window, which distinguishes an outage from a player that was up and idle.
func (s *server) screenWasOffline(ctx context.Context, screenID uuid.UUID, start, end time.Time) bool {
	var offlineSeconds float64
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(i.ended_at,$3),$3) - GREATEST(i.started_at,$2)))),0)::float8
		FROM screen_state_intervals i
		WHERE i.screen_id=$1 AND i.state IN('offline','unknown')
		  AND i.started_at<$3 AND COALESCE(i.ended_at,$3)>$2`, screenID, start, end).Scan(&offlineSeconds)
	return offlineSeconds >= end.Sub(start).Seconds()/2
}

// syncExpectedWindowsFromStatus keeps the expected model in step with what the
// server currently believes each screen should be playing. It runs on the
// heartbeat path, which is the one signal every player sends, so an expectation
// exists even for a player whose event vocabulary the server does not recognise.
func (s *server) syncExpectedWindowFromStatus(r *http.Request, tx pgx.Tx, screenID uuid.UUID, status heartbeatActivityState, now time.Time) error {
	ctx := activityContextWithoutCancel(r.Context())

	// What the server believes should be playing, from the status authority.
	presentationID, presentationType := "", ""
	if status.ScheduleID != nil {
		presentationID, presentationType = status.ScheduleID.String(), "schedule"
	}
	trigger := status.SelectionSource
	if trigger == "" {
		trigger = "direct"
	}
	scheduleID := ""
	if status.ScheduleID != nil {
		scheduleID = status.ScheduleID.String()
	}

	var open struct {
		ID          uuid.UUID
		Schedule    string
		Manifest    *int64
		EmergencyID *uuid.UUID
		Trigger     string
	}
	err := tx.QueryRow(ctx, `
		SELECT id,schedule_id,manifest_version,overridden_by_emergency_id,trigger_source
		FROM expected_playback_windows
		WHERE screen_id=$1 AND superseded_at IS NULL AND expected_end IS NULL
		ORDER BY expected_start DESC LIMIT 1`, screenID).Scan(
		&open.ID, &open.Schedule, &open.Manifest, &open.EmergencyID, &open.Trigger)
	hasOpen := err == nil

	// Playback that is not supposed to happen closes the window rather than
	// opening one, so off-hours and disabled time never become missed playback.
	if !playbackExpected(fleetScreenSignals{
		PlaybackState:   status.PlaybackState,
		PlaybackDisable: status.PlaybackState == "disabled",
		ActiveManifest:  status.ManifestVersion,
	}) {
		if hasOpen {
			return supersedeExpectedWindows(ctx, tx, screenID, now, suppressionReason(status))
		}
		return nil
	}

	changed := !hasOpen ||
		open.Schedule != scheduleID ||
		!sameInt64(open.Manifest, status.ManifestVersion) ||
		!sameUUID(open.EmergencyID, status.EmergencyID) ||
		open.Trigger != trigger
	if !changed {
		return nil
	}
	return openExpectedWindow(ctx, tx, now, expectationChangeReason(open.Schedule, scheduleID, status), expectedWindowInput{
		ScreenID:         screenID,
		PresentationType: presentationType,
		PresentationID:   presentationID,
		ManifestVersion:  status.ManifestVersion,
		ScheduleID:       scheduleID,
		TriggerSource:    trigger,
		EmergencyID:      status.EmergencyID,
	})
}

// suppressionReason names why normal playback is not expected right now, from
// the closed set the schema allows.
func suppressionReason(status heartbeatActivityState) string {
	switch normalizePlaybackState(status.PlaybackState) {
	case "off_hours":
		return "active_hours_changed"
	case "disabled":
		return "screen_disabled"
	default:
		return "deployment_suppressed_playback"
	}
}

func expectationChangeReason(previousSchedule, nextSchedule string, status heartbeatActivityState) string {
	switch {
	case status.EmergencyID != nil:
		return "emergency_started"
	case previousSchedule != "" && nextSchedule == "":
		return "schedule_ended"
	case nextSchedule != "" && previousSchedule != nextSchedule:
		return "schedule_started"
	case previousSchedule == nextSchedule && nextSchedule == "":
		return "assignment_changed"
	default:
		return "manifest_changed"
	}
}
