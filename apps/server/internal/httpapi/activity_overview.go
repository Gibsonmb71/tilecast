package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (s *server) activityOverview(w http.ResponseWriter, r *http.Request) {
	window, err := parseActivityWindow(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_range_invalid", err.Error())
		return
	}
	var data activityOverviewData
	data.Range.From, data.Range.To = window.From, window.To
	// Marshal empty lists as [] rather than null; the dashboard indexes into
	// these collections directly.
	data.NeedsAttention = []activityAttentionItem{}
	data.Timeline = []activityTimelineItem{}
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM screens WHERE enabled=TRUE AND last_heartbeat_at>now()-interval '5 minutes'`).Scan(&data.Cards.ScreensReportingNormally)
	_ = s.db.QueryRow(r.Context(), `SELECT count(DISTINCT screen_id) FROM screen_state_intervals WHERE started_at<$2 AND COALESCE(ended_at,$2)>$1 AND state IN('offline','degraded','unknown')`, window.From, window.To).Scan(&data.Cards.ScreensWithPlaybackGaps)
	_ = s.db.QueryRow(r.Context(), `SELECT COALESCE(sum(actual_duration_ms) FILTER(WHERE result IN('completed','recovered','partial')),0),count(*) FILTER(WHERE result='failed'),count(*) FILTER(WHERE result='partial') FROM playback_sessions WHERE started_at>=$1 AND started_at<$2`, window.From, window.To).Scan(&data.Cards.ConfirmedDurationMS, &data.Cards.PlaybackFailures, &data.Cards.InterruptedPlays)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM player_activity_events WHERE occurred_at>=$1 AND occurred_at<$2 AND event_type='emergency.active'`, window.From, window.To).Scan(&data.Cards.EmergencyActivations)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM player_activity_events WHERE occurred_at>=$1 AND occurred_at<$2 AND category='updates' AND result='failed'`, window.From, window.To).Scan(&data.Cards.FailedPlayerUpdates)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM audit_logs WHERE created_at>=$1 AND created_at<$2 AND result='success'`, window.From, window.To).Scan(&data.Cards.RecentAdminChanges)

	attentionRows, err := s.db.Query(r.Context(), `
		WITH latest AS (
			SELECT DISTINCT ON(e.screen_id) e.screen_id,e.event_type,e.severity,e.occurred_at,e.failure_message
			FROM player_activity_events e WHERE e.severity IN('warning','error','critical')
			ORDER BY e.screen_id,e.occurred_at DESC,e.sequence DESC
		)
		SELECT s.id,s.name,
		       CASE WHEN s.last_heartbeat_at IS NULL OR s.last_heartbeat_at<now()-interval '5 minutes' THEN 'not_reporting' ELSE COALESCE(l.event_type,'unknown') END,
		       CASE WHEN s.last_heartbeat_at IS NULL OR s.last_heartbeat_at<now()-interval '5 minutes' THEN 'error' ELSE COALESCE(l.severity,'warning') END,
		       CASE WHEN s.last_heartbeat_at IS NULL OR s.last_heartbeat_at<now()-interval '5 minutes' THEN 'Screen is not reporting.' ELSE COALESCE(NULLIF(l.failure_message,''),replace(l.event_type,'.',' ')) END,
		       COALESCE(l.occurred_at,s.last_heartbeat_at,s.created_at)
		FROM screens s LEFT JOIN latest l ON l.screen_id=s.id
		WHERE s.enabled=TRUE AND (s.last_heartbeat_at IS NULL OR s.last_heartbeat_at<now()-interval '5 minutes' OR l.occurred_at>now()-interval '24 hours')
		ORDER BY 6 DESC LIMIT 25`)
	if err == nil {
		defer attentionRows.Close()
		for attentionRows.Next() {
			var item activityAttentionItem
			if attentionRows.Scan(&item.ScreenID, &item.ScreenName, &item.Kind, &item.Severity, &item.Description, &item.OccurredAt) == nil {
				data.NeedsAttention = append(data.NeedsAttention, item)
			}
		}
	}

	timelineRows, err := s.db.Query(r.Context(), `
		SELECT id::text,occurred_at,'screen',severity,
		       CASE WHEN content_id IS NOT NULL THEN replace(event_type,'.',' ')||' · '||content_id ELSE replace(event_type,'.',' ') END,
		       screen_id,presentation_id
		FROM player_activity_events
		WHERE occurred_at>=$1 AND occurred_at<$2 AND (severity IN('warning','error','critical') OR event_type IN('presentation.started','presentation.recovered','schedule.became_active','emergency.active','update.installation_failed'))
		UNION ALL
		SELECT id::text,created_at,'audit',CASE WHEN result='failure' THEN 'error' ELSE 'info' END,
		       COALESCE(NULLIF(summary,''),replace(action,'.',' ')),NULL,resource_id
		FROM audit_logs WHERE created_at>=$1 AND created_at<$2 AND result IN('success','failure')
		ORDER BY 2 DESC LIMIT 40`, window.From, window.To)
	if err == nil {
		defer timelineRows.Close()
		for timelineRows.Next() {
			var item activityTimelineItem
			if timelineRows.Scan(&item.ID, &item.Timestamp, &item.Domain, &item.Severity, &item.Description, &item.ScreenID, &item.ResourceID) == nil {
				data.Timeline = append(data.Timeline, item)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

func (s *server) screenActivity(w http.ResponseWriter, r *http.Request) {
	screenID, err := uuid.Parse(strings.TrimPrefix(r.URL.Path, "/api/v1/activity/screens/"))
	if err != nil {
		writeError(w, http.StatusNotFound, "screen_not_found", "Screen was not found.")
		return
	}
	data := screenActivityData{ScreenID: screenID, RecentProof: []proofOfPlayRecord{}, RecentEvents: []screenEventRecord{}}
	row := s.db.QueryRow(r.Context(), proofSelectSQL+` WHERE p.screen_id=$1 AND p.ended_at IS NULL ORDER BY p.started_at DESC LIMIT 1`, screenID)
	if item, err := scanProof(row.Scan, activitySession(r).User.Role); err == nil {
		data.CurrentPresentation = &item
	}
	rows, err := s.db.Query(r.Context(), proofSelectSQL+` WHERE p.screen_id=$1 ORDER BY p.started_at DESC LIMIT 10`, screenID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			if item, err := scanProof(rows.Scan, activitySession(r).User.Role); err == nil {
				data.RecentProof = append(data.RecentProof, item)
			}
		}
	}
	if activityCanSeeSensitive(activitySession(r).User.Role) {
		eventRows, err := s.db.Query(r.Context(), `
			SELECT e.id,e.occurred_at,e.received_at,e.screen_id,s.name,NULL::uuid,'',e.sequence,e.event_type,e.category,e.severity,e.result,e.manifest_version,
			       COALESCE(e.presentation_type,''),COALESCE(e.presentation_id,''),COALESCE(e.content_type,''),COALESCE(e.content_id,''),
			       COALESCE(e.failure_code,''),COALESCE(e.failure_message,''),e.metadata
			FROM player_activity_events e JOIN screens s ON s.id=e.screen_id WHERE e.screen_id=$1 ORDER BY e.occurred_at DESC,e.sequence DESC LIMIT 10`, screenID)
		if err == nil {
			defer eventRows.Close()
			for eventRows.Next() {
				var item screenEventRecord
				var presentationType, presentationID, contentType, contentID string
				var raw []byte
				if eventRows.Scan(&item.ID, &item.Timestamp, &item.ReceivedAt, &item.ScreenID, &item.ScreenName, &item.GroupID, &item.GroupName, &item.Sequence, &item.EventType, &item.Category, &item.Severity, &item.Result, &item.ManifestVersion, &presentationType, &presentationID, &contentType, &contentID, &item.FailureCode, &item.FailureMessage, &raw) == nil {
					item.RelatedType, item.RelatedID = activityRelatedResource(presentationType, presentationID, contentType, contentID)
					item.Description = screenEventDescription(item.EventType, item.ScreenName, item.RelatedType)
					item.Details = activityMetadata(raw, item.Severity == "error", activitySession(r).User.Role)
					data.RecentEvents = append(data.RecentEvents, item)
				}
			}
		}
	}
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM screen_state_intervals WHERE screen_id=$1 AND state IN('offline','degraded','unknown') AND started_at>now()-interval '30 days'`, screenID).Scan(&data.PlaybackGaps)
	_ = s.db.QueryRow(r.Context(), `SELECT max(started_at) FROM screen_state_intervals WHERE screen_id=$1 AND state='healthy'`, screenID).Scan(&data.LastHealthyPlayback)
	_ = s.db.QueryRow(r.Context(), `SELECT max(occurred_at) FROM player_activity_events WHERE screen_id=$1 AND event_type IN('manifest.activated','presentation.activated') AND result IN('completed','success','playing')`, screenID).Scan(&data.LastSuccessfulManifestActivation)
	if len(data.RecentEvents) > 0 && (data.RecentEvents[0].Severity == "warning" || data.RecentEvents[0].Severity == "error" || data.RecentEvents[0].Severity == "critical") {
		item := data.RecentEvents[0]
		data.CurrentIssue = &activityAttentionItem{ScreenID: screenID, ScreenName: item.ScreenName, Kind: item.EventType, Severity: item.Severity, Description: item.Description, OccurredAt: item.Timestamp}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

func activityRelatedResource(presentationType, presentationID, contentType, contentID string) (string, string) {
	if contentID != "" {
		return contentType, contentID
	}
	return presentationType, presentationID
}

func screenEventDescription(eventType, screenName, relatedType string) string {
	label := strings.ReplaceAll(eventType, ".", " ")
	if relatedType != "" {
		return screenName + " · " + label + " (" + strings.ReplaceAll(relatedType, "_", " ") + ")"
	}
	return screenName + " · " + label
}

func optionalTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func optionalDate(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format("2006-01-02")
}

func optionalInt64(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func marshalActivityDetails(value map[string]any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
