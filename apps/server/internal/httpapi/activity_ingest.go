package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

var activityEventTypePattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{2,95}$`)

type playerActivityBatchInput struct {
	Events []playerActivityEventInput `json:"events"`
}

type playerActivityEventInput struct {
	ID                 uuid.UUID      `json:"id"`
	Sequence           int64          `json:"sequence"`
	EventType          string         `json:"eventType"`
	Category           string         `json:"category,omitempty"`
	Severity           string         `json:"severity,omitempty"`
	OccurredAt         time.Time      `json:"occurredAt"`
	ElapsedRealtimeMS  *int64         `json:"elapsedRealtimeMs,omitempty"`
	PlayerTimezone     string         `json:"playerTimezone,omitempty"`
	ManifestVersion    *int64         `json:"manifestVersion,omitempty"`
	PresentationType   string         `json:"presentationType,omitempty"`
	PresentationID     string         `json:"presentationId,omitempty"`
	PresentationRev    string         `json:"presentationRevision,omitempty"`
	ContentType        string         `json:"contentType,omitempty"`
	ContentID          string         `json:"contentId,omitempty"`
	PlaylistItemID     string         `json:"playlistItemId,omitempty"`
	LayoutPlacementID  string         `json:"layoutPlacementId,omitempty"`
	ActivitySessionID  string         `json:"activitySessionId,omitempty"`
	Result             string         `json:"result,omitempty"`
	DurationMS         *int64         `json:"durationMs,omitempty"`
	ExpectedDurationMS *int64         `json:"expectedDurationMs,omitempty"`
	FailureCode        string         `json:"failureCode,omitempty"`
	FailureMessage     string         `json:"failureMessage,omitempty"`
	TriggerContext     string         `json:"trigger,omitempty"`
	ScheduleID         string         `json:"scheduleId,omitempty"`
	EmergencyID        string         `json:"emergencyId,omitempty"`
	SourceID           string         `json:"sourceId,omitempty"`
	SelectedRecordID   string         `json:"selectedRecordId,omitempty"`
	SelectionDate      string         `json:"selectionDate,omitempty"`
	SourceCachedAt     *time.Time     `json:"sourceCachedAt,omitempty"`
	SourceRevision     string         `json:"sourceRevision,omitempty"`
	SnapshotHash       string         `json:"snapshotHash,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
	Priority           int16          `json:"priority,omitempty"`
}

type playerActivityBatchResult struct {
	Accepted             int      `json:"accepted"`
	Duplicates           int      `json:"duplicates"`
	HighestSequence      int64    `json:"highestSequence"`
	AcknowledgedEventIDs []string `json:"acknowledgedEventIds"`
}

func (s *server) ingestPlayerActivity(w http.ResponseWriter, r *http.Request) {
	var input playerActivityBatchInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "player_activity_invalid", err.Error())
		return
	}
	if len(input.Events) == 0 || len(input.Events) > 200 {
		writeError(w, http.StatusUnprocessableEntity, "player_activity_batch_invalid", "Player activity batches must contain between 1 and 200 events.")
		return
	}
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	result := playerActivityBatchResult{AcknowledgedEventIDs: make([]string, 0, len(input.Events))}
	now := time.Now().UTC()
	for index := range input.Events {
		event := &input.Events[index]
		if err := normalizePlayerActivity(event, now); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "player_activity_event_invalid", fmt.Sprintf("Event %d: %s", index+1, err))
			return
		}
		inserted, err := s.insertPlayerActivityEvent(r, tx, principal.ScreenID, *event)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		result.AcknowledgedEventIDs = append(result.AcknowledgedEventIDs, event.ID.String())
		if event.Sequence > result.HighestSequence {
			result.HighestSequence = event.Sequence
		}
		if !inserted {
			result.Duplicates++
			continue
		}
		result.Accepted++
		if err := s.derivePlayerActivity(r, tx, principal.ScreenID, *event); err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	if err := closeExpiredPlaybackSessions(r, tx, principal.ScreenID, now); err != nil {
		s.internalError(w, r, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"data": result})
}

func normalizePlayerActivity(event *playerActivityEventInput, now time.Time) error {
	if event.ID == uuid.Nil {
		return errors.New("id is required")
	}
	if event.Sequence <= 0 {
		return errors.New("sequence must be positive")
	}
	event.EventType = strings.ToLower(strings.TrimSpace(event.EventType))
	if !activityEventTypePattern.MatchString(event.EventType) {
		return errors.New("eventType is invalid")
	}
	if event.OccurredAt.IsZero() || event.OccurredAt.Before(now.Add(-370*24*time.Hour)) || event.OccurredAt.After(now.Add(15*time.Minute)) {
		return errors.New("occurredAt is outside the accepted reporting window")
	}
	event.OccurredAt = event.OccurredAt.UTC()
	if event.Category == "" {
		event.Category = activityCategory(event.EventType)
	}
	event.Category = safeActivityText(strings.ToLower(event.Category), 48)
	if event.Severity == "" {
		event.Severity = activitySeverity(event.EventType)
	}
	if !containsActivityValue(event.Severity, "debug", "info", "warning", "error", "critical") {
		return errors.New("severity is invalid")
	}
	if event.Result == "" {
		event.Result = activityResultForEvent(event.EventType)
	}
	if !containsActivityValue(event.Result, "playing", "completed", "partial", "skipped", "failed", "unknown", "recovered", "success") {
		return errors.New("result is invalid")
	}
	if event.DurationMS != nil && *event.DurationMS < 0 || event.ExpectedDurationMS != nil && *event.ExpectedDurationMS < 0 {
		return errors.New("durations may not be negative")
	}
	if event.ElapsedRealtimeMS != nil && *event.ElapsedRealtimeMS < 0 {
		return errors.New("elapsedRealtimeMs may not be negative")
	}
	if event.PlayerTimezone == "" {
		event.PlayerTimezone = "UTC"
	}
	if len(event.PlayerTimezone) > 80 {
		return errors.New("playerTimezone is too long")
	}
	event.PresentationType = safeActivityText(event.PresentationType, 48)
	event.PresentationID = safeActivityText(event.PresentationID, 128)
	event.PresentationRev = safeActivityText(event.PresentationRev, 128)
	event.ContentType = safeActivityText(event.ContentType, 48)
	event.ContentID = safeActivityText(event.ContentID, 128)
	event.PlaylistItemID = safeActivityText(event.PlaylistItemID, 128)
	event.LayoutPlacementID = safeActivityText(event.LayoutPlacementID, 128)
	event.ActivitySessionID = safeActivityText(event.ActivitySessionID, 160)
	event.FailureCode = safeActivityText(event.FailureCode, 96)
	event.FailureMessage = safeActivityText(event.FailureMessage, 240)
	event.TriggerContext = safeActivityText(event.TriggerContext, 96)
	event.ScheduleID = safeActivityText(event.ScheduleID, 128)
	event.EmergencyID = safeActivityText(event.EmergencyID, 128)
	event.SourceID = safeActivityText(event.SourceID, 128)
	event.SelectedRecordID = safeActivityText(event.SelectedRecordID, 160)
	event.SourceRevision = safeActivityText(event.SourceRevision, 128)
	event.SnapshotHash = safeActivityText(strings.ToLower(event.SnapshotHash), 128)
	if event.Priority < 0 || event.Priority > 9 {
		return errors.New("priority must be between 0 and 9")
	}
	event.Metadata = sanitizeActivityMap(event.Metadata, true)
	return nil
}

func (s *server) insertPlayerActivityEvent(r *http.Request, tx pgx.Tx, screenID uuid.UUID, event playerActivityEventInput) (bool, error) {
	metadata, _ := json.Marshal(event.Metadata)
	var selectionDate any
	if event.SelectionDate != "" {
		parsed, err := time.Parse("2006-01-02", event.SelectionDate)
		if err != nil {
			return false, errors.New("selectionDate must use YYYY-MM-DD")
		}
		selectionDate = parsed
	}
	var inserted uuid.UUID
	err := tx.QueryRow(r.Context(), `
		INSERT INTO player_activity_events(
			id,screen_id,sequence,event_type,category,severity,occurred_at,elapsed_realtime_ms,player_timezone,
			manifest_version,presentation_type,presentation_id,presentation_revision,content_type,content_id,
			playlist_item_id,layout_placement_id,activity_session_id,result,duration_ms,expected_duration_ms,
			failure_code,failure_message,trigger_context,schedule_id,emergency_id,source_id,selected_record_id,
			selection_date,source_cached_at,source_revision,snapshot_hash,metadata,priority)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''),NULLIF($12,''),NULLIF($13,''),NULLIF($14,''),NULLIF($15,''),
		       NULLIF($16,''),NULLIF($17,''),NULLIF($18,''),$19,$20,$21,NULLIF($22,''),NULLIF($23,''),NULLIF($24,''),
		       NULLIF($25,''),NULLIF($26,''),NULLIF($27,''),NULLIF($28,''),$29,$30,NULLIF($31,''),NULLIF($32,''),$33::jsonb,$34)
		ON CONFLICT DO NOTHING RETURNING id`,
		event.ID, screenID, event.Sequence, event.EventType, event.Category, event.Severity, event.OccurredAt, event.ElapsedRealtimeMS, event.PlayerTimezone,
		event.ManifestVersion, event.PresentationType, event.PresentationID, event.PresentationRev, event.ContentType, event.ContentID,
		event.PlaylistItemID, event.LayoutPlacementID, event.ActivitySessionID, event.Result, event.DurationMS, event.ExpectedDurationMS,
		event.FailureCode, event.FailureMessage, event.TriggerContext, event.ScheduleID, event.EmergencyID, event.SourceID, event.SelectedRecordID,
		selectionDate, event.SourceCachedAt, event.SourceRevision, event.SnapshotHash, string(metadata), event.Priority).Scan(&inserted)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *server) derivePlayerActivity(r *http.Request, tx pgx.Tx, screenID uuid.UUID, event playerActivityEventInput) error {
	if activityState, ok := screenStateForEvent(event); ok {
		if err := updateScreenStateInterval(r, tx, screenID, event, activityState); err != nil {
			return err
		}
	}
	if event.EventType == "heartbeat.gap_detected" {
		if _, err := tx.Exec(r.Context(), `
			UPDATE playback_sessions SET ended_at=$2,result='unknown',
				actual_duration_ms=GREATEST(0,EXTRACT(EPOCH FROM ($2-started_at))*1000)::bigint,
				metadata=metadata||'{"closedReason":"heartbeat_gap"}'::jsonb,updated_at=now()
			WHERE screen_id=$1 AND ended_at IS NULL`, screenID, event.OccurredAt); err != nil {
			return err
		}
	}
	if isPlaybackStart(event.EventType) {
		return startPlaybackSession(r, tx, screenID, event)
	}
	if isPlaybackEnd(event.EventType) {
		return endPlaybackSession(r, tx, screenID, event)
	}
	return nil
}

func startPlaybackSession(r *http.Request, tx pgx.Tx, screenID uuid.UUID, event playerActivityEventInput) error {
	sessionID := event.ActivitySessionID
	if sessionID == "" {
		sessionID = event.ID.String()
	}
	if event.EventType == "presentation.started" || event.EventType == "presentation.activated" || event.EventType == "layout.activated" || event.EventType == "playlist.started" {
		_, err := tx.Exec(r.Context(), `
			UPDATE playback_sessions SET ended_at=$2,result='partial',actual_duration_ms=GREATEST(0,EXTRACT(EPOCH FROM ($2-started_at))*1000)::bigint,
			metadata=metadata||'{"closedReason":"incompatible_start"}'::jsonb,updated_at=now()
			WHERE screen_id=$1 AND ended_at IS NULL AND activity_session_id<>$3`, screenID, event.OccurredAt, sessionID)
		if err != nil {
			return err
		}
	}
	var groupID *uuid.UUID
	_ = tx.QueryRow(r.Context(), `SELECT screen_group_id FROM screen_group_memberships WHERE screen_id=$1 ORDER BY screen_group_id LIMIT 1`, screenID).Scan(&groupID)
	var parentID *uuid.UUID
	if parentKey, ok := event.Metadata["parentActivitySessionId"].(string); ok && parentKey != "" {
		_ = tx.QueryRow(r.Context(), `SELECT id FROM playback_sessions WHERE screen_id=$1 AND activity_session_id=$2`, screenID, parentKey).Scan(&parentID)
	}
	metadata, _ := json.Marshal(event.Metadata)
	presentationName, _ := event.Metadata["presentationName"].(string)
	contentName, _ := event.Metadata["contentName"].(string)
	_, err := tx.Exec(r.Context(), `
		INSERT INTO playback_sessions(
			id,screen_id,group_id,parent_session_id,activity_session_id,start_event_id,started_at,presentation_type,
			presentation_id,presentation_revision,presentation_name,content_type,content_id,content_name,playlist_item_id,
			layout_placement_id,expected_duration_ms,result,trigger_context,schedule_id,emergency_id,manifest_version,
			source_id,selected_record_id,selection_date,source_cached_at,source_revision,snapshot_hash,metadata)
		VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),NULLIF($13,''),
		       NULLIF($14,''),NULLIF($15,''),NULLIF($16,''),$17,'playing',NULLIF($18,''),NULLIF($19,''),NULLIF($20,''),$21,
		       NULLIF($22,''),NULLIF($23,''),NULLIF($24,'')::date,$25,NULLIF($26,''),NULLIF($27,''),$28::jsonb)
		ON CONFLICT(screen_id,activity_session_id) DO NOTHING`,
		uuid.New(), screenID, groupID, parentID, sessionID, event.ID, event.OccurredAt, event.PresentationType,
		event.PresentationID, event.PresentationRev, safeActivityText(presentationName, 240), event.ContentType, event.ContentID,
		safeActivityText(contentName, 240), event.PlaylistItemID, event.LayoutPlacementID, event.ExpectedDurationMS, event.TriggerContext,
		event.ScheduleID, event.EmergencyID, event.ManifestVersion, event.SourceID, event.SelectedRecordID, event.SelectionDate,
		event.SourceCachedAt, event.SourceRevision, event.SnapshotHash, string(metadata))
	return err
}

func endPlaybackSession(r *http.Request, tx pgx.Tx, screenID uuid.UUID, event playerActivityEventInput) error {
	if event.ActivitySessionID == "" {
		return nil
	}
	result := event.Result
	if result == "success" {
		result = "completed"
	}
	if result == "playing" {
		result = "unknown"
	}
	metadata, _ := json.Marshal(event.Metadata)
	tag, err := tx.Exec(r.Context(), `
		UPDATE playback_sessions SET end_event_id=$3,ended_at=$4,
			actual_duration_ms=COALESCE($5,GREATEST(0,EXTRACT(EPOCH FROM ($4-started_at))*1000)::bigint),
			result=$6,failure_code=NULLIF($7,''),metadata=metadata||$8::jsonb,updated_at=now()
		WHERE screen_id=$1 AND activity_session_id=$2 AND ended_at IS NULL`,
		screenID, event.ActivitySessionID, event.ID, event.OccurredAt, event.DurationMS, result, event.FailureCode, string(metadata))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 && (event.EventType == "presentation.failed" || event.EventType == "widget.failed" || event.EventType == "playlist_item.failed") {
		fallback := event
		fallback.Result = result
		fallback.ActivitySessionID = event.ActivitySessionID
		if err := startPlaybackSession(r, tx, screenID, fallback); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE playback_sessions SET end_event_id=$3,ended_at=$4,actual_duration_ms=COALESCE($5,0),result=$6,failure_code=NULLIF($7,''),updated_at=now() WHERE screen_id=$1 AND activity_session_id=$2`, screenID, event.ActivitySessionID, event.ID, event.OccurredAt, event.DurationMS, result, event.FailureCode)
	}
	return err
}

func updateScreenStateInterval(r *http.Request, tx pgx.Tx, screenID uuid.UUID, event playerActivityEventInput, state string) error {
	_, err := tx.Exec(r.Context(), `UPDATE screen_state_intervals SET ended_at=$2,end_event_id=$3 WHERE screen_id=$1 AND ended_at IS NULL AND state<>$4`, screenID, event.OccurredAt, event.ID, state)
	if err != nil {
		return err
	}
	metadata, _ := json.Marshal(event.Metadata)
	_, err = tx.Exec(r.Context(), `INSERT INTO screen_state_intervals(id,screen_id,state,started_at,start_event_id,reason_code,metadata) SELECT $1,$2,$3,$4,$5,NULLIF($6,''),$7::jsonb WHERE NOT EXISTS(SELECT 1 FROM screen_state_intervals WHERE screen_id=$2 AND state=$3 AND ended_at IS NULL) ON CONFLICT DO NOTHING`, uuid.New(), screenID, state, event.OccurredAt, event.ID, event.FailureCode, string(metadata))
	return err
}

func closeExpiredPlaybackSessions(r *http.Request, tx pgx.Tx, screenID uuid.UUID, now time.Time) error {
	_, err := tx.Exec(r.Context(), `
		UPDATE playback_sessions SET ended_at=LEAST($2::timestamptz,started_at+interval '6 hours'),result='unknown',
			actual_duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (LEAST($2::timestamptz,started_at+interval '6 hours')-started_at))*1000)::bigint,
			metadata=metadata||'{"closedReason":"bounded_timeout"}'::jsonb,updated_at=now()
		WHERE screen_id=$1 AND ended_at IS NULL AND started_at < $2::timestamptz-interval '6 hours'`, screenID, now)
	return err
}

func isPlaybackStart(eventType string) bool {
	switch eventType {
	case "presentation.started", "presentation.activated", "playlist.started", "layout.activated", "playlist_item.started", "media.started", "widget.started", "layout_zone_item.started", "data_widget.activated":
		return true
	default:
		return false
	}
}

func isPlaybackEnd(eventType string) bool {
	return strings.HasSuffix(eventType, ".completed") || strings.HasSuffix(eventType, ".stopped") || strings.HasSuffix(eventType, ".failed") || strings.HasSuffix(eventType, ".skipped") || eventType == "presentation.recovered"
}

func screenStateForEvent(event playerActivityEventInput) (string, bool) {
	switch event.EventType {
	case "player.connected", "connection.restored":
		return "online", true
	case "player.disconnected":
		return "offline", true
	case "heartbeat.gap_detected", "renderer.failure", "decoder.failure", "storage.pressure":
		return "degraded", true
	case "safe_mode.entered":
		return "safe_mode", true
	case "safe_mode.exited", "manifest.activated", "presentation.started", "presentation.activated":
		return "healthy", true
	default:
		return "", false
	}
}

func activityCategory(eventType string) string {
	prefix := strings.SplitN(eventType, ".", 2)[0]
	switch prefix {
	case "player", "connection", "heartbeat":
		return "connectivity"
	case "manifest", "dependencies", "presentation":
		return "manifest"
	case "playlist", "playlist_item", "widget", "layout", "layout_zone_item", "media", "renderer", "decoder", "fallback", "playback", "data_widget":
		return "playback"
	case "schedule", "assignment":
		return "scheduling"
	case "command":
		return "commands"
	case "safe_mode", "watchdog", "boot", "storage", "sleep", "wake", "foreground":
		return "reliability"
	case "update":
		return "updates"
	case "emergency":
		return "emergencies"
	default:
		return "system"
	}
}

func activitySeverity(eventType string) string {
	if strings.Contains(eventType, "failed") || strings.Contains(eventType, "failure") {
		return "error"
	}
	if strings.Contains(eventType, "gap") || strings.Contains(eventType, "pressure") || strings.Contains(eventType, "safe_mode") || strings.Contains(eventType, "recovery") {
		return "warning"
	}
	return "info"
}

func activityResultForEvent(eventType string) string {
	switch {
	case strings.HasSuffix(eventType, ".started"), strings.HasSuffix(eventType, ".activated"):
		return "playing"
	case strings.HasSuffix(eventType, ".completed"), strings.HasSuffix(eventType, ".succeeded"), strings.HasSuffix(eventType, ".verified"):
		return "completed"
	case strings.HasSuffix(eventType, ".failed"), strings.HasSuffix(eventType, ".failure"):
		return "failed"
	case strings.HasSuffix(eventType, ".skipped"):
		return "skipped"
	case strings.HasSuffix(eventType, ".recovered"), strings.Contains(eventType, "restored"):
		return "recovered"
	default:
		return "unknown"
	}
}

func containsActivityValue(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}
