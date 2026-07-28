package httpapi

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *server) listProofOfPlay(w http.ResponseWriter, r *http.Request) {
	window, err := parseActivityWindow(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_range_invalid", err.Error())
		return
	}
	page, err := parseActivityPage(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_page_invalid", err.Error())
		return
	}
	clauses, args, err := proofClauses(r, window)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "proof_filter_invalid", err.Error())
		return
	}
	if page.Cursor != nil {
		args = append(args, page.Cursor.Time, page.Cursor.ID)
		clauses = append(clauses, fmt.Sprintf("(p.started_at,p.id)<($%d,$%d)", len(args)-1, len(args)))
	}
	args = append(args, page.Limit+1)
	rows, err := s.db.Query(r.Context(), proofSelectSQL+` WHERE `+strings.Join(clauses, " AND ")+` ORDER BY p.started_at DESC,p.id DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	items := make([]proofOfPlayRecord, 0, page.Limit+1)
	for rows.Next() {
		item, err := scanProof(rows.Scan, activitySession(r).User.Role)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		items = append(items, item)
	}
	result := proofOfPlayPage{Items: items}
	if len(items) > page.Limit {
		last := items[page.Limit-1]
		result.Items = items[:page.Limit]
		result.NextCursor = encodeActivityCursor(activityCursor{Time: last.StartedAt, ID: last.ID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

const proofSelectSQL = `
	SELECT p.id,p.started_at,p.ended_at,p.screen_id,s.name,p.group_id,COALESCE(g.name,''),
	       COALESCE(p.presentation_type,''),COALESCE(p.presentation_id,''),COALESCE(p.presentation_revision,''),
	       COALESCE(NULLIF(p.presentation_name,''),pl.name,l.name,''),
	       COALESCE(p.content_type,''),COALESCE(p.content_id,''),COALESCE(NULLIF(p.content_name,''),a.name,''),COALESCE(p.playlist_item_id,''),COALESCE(p.layout_placement_id,''),
	       p.actual_duration_ms,p.expected_duration_ms,p.result,COALESCE(p.trigger_context,''),COALESCE(p.schedule_id,''),COALESCE(p.emergency_id,''),
	       p.manifest_version,COALESCE(p.failure_code,''),COALESCE(p.source_id,''),COALESCE(p.selected_record_id,''),p.selection_date,
	       p.source_cached_at,COALESCE(p.source_revision,''),COALESCE(p.snapshot_hash,''),p.session_type,COALESCE(p.terminal_reason,''),p.metadata
	FROM playback_sessions p
	JOIN screens s ON s.id=p.screen_id
	LEFT JOIN screen_groups g ON g.id=p.group_id
	LEFT JOIN playlists pl ON p.presentation_type='playlist' AND p.presentation_id=pl.id::text
	LEFT JOIN layouts l ON p.presentation_type='layout' AND p.presentation_id=l.id::text
	LEFT JOIN assets a ON p.content_id=a.id::text`

type proofScanner func(dest ...any) error

func scanProof(scan proofScanner, role string) (proofOfPlayRecord, error) {
	var item proofOfPlayRecord
	var raw []byte
	err := scan(&item.ID, &item.StartedAt, &item.EndedAt, &item.ScreenID, &item.ScreenName, &item.GroupID, &item.GroupName,
		&item.PresentationType, &item.PresentationID, &item.PresentationRevision, &item.PresentationName,
		&item.ContentType, &item.ContentID, &item.ContentName, &item.PlaylistItemID, &item.LayoutPlacementID,
		&item.ActualDurationMS, &item.ExpectedDurationMS, &item.Result, &item.Trigger, &item.ScheduleID, &item.EmergencyID,
		&item.ManifestVersion, &item.FailureCode, &item.SourceID, &item.SelectedRecordID, &item.SelectionDate,
		&item.SourceCachedAt, &item.SourceRevision, &item.SnapshotHash, &item.SessionType, &item.TerminalReason, &raw)
	if err != nil {
		return item, err
	}
	item.Details = activityMetadata(raw, item.Result == "failed", role)
	return item, nil
}

func proofClauses(r *http.Request, window activityWindow) ([]string, []any, error) {
	clauses := []string{"p.started_at >= $1", "p.started_at < $2"}
	args := []any{window.From, window.To}
	for key, expression := range map[string]string{
		"screen": "p.screen_id = $%d", "group": "p.group_id = $%d",
	} {
		if err := appendActivityUUIDFilter(&clauses, &args, expression, queryValue(r, key)); err != nil {
			return clauses, args, err
		}
	}
	appendActivityFilter(&clauses, &args, "p.result = $%d", queryValue(r, "result"))
	if value := queryValue(r, "sessionType"); value != "" {
		if !isActivitySessionType(value) {
			return clauses, args, errors.New("sessionType is invalid")
		}
		appendActivityFilter(&clauses, &args, "p.session_type = $%d", value)
	}
	if value := queryValue(r, "terminalReason"); value != "" {
		// "unexpected" is the set the Interrupted plays metric counts. Without
		// it the drill-down could only pick one reason and would not match.
		if value == "unexpected" {
			args = append(args, interruptedTerminalReasons())
			clauses = append(clauses, "p.terminal_reason = ANY($"+strconv.Itoa(len(args))+")")
		} else if !isActivityTerminalReason(value) {
			return clauses, args, errors.New("terminalReason is invalid")
		} else {
			appendActivityFilter(&clauses, &args, "p.terminal_reason = $%d", value)
		}
	}
	appendActivityFilter(&clauses, &args, "p.content_id = $%d", firstQueryValue(r, "media", "widget", "content"))
	appendActivityFilter(&clauses, &args, "p.presentation_id = $%d AND p.presentation_type='playlist'", queryValue(r, "playlist"))
	appendActivityFilter(&clauses, &args, "p.presentation_id = $%d AND p.presentation_type='layout'", queryValue(r, "layout"))
	appendActivityFilter(&clauses, &args, "p.schedule_id = $%d", queryValue(r, "schedule"))
	appendActivityFilter(&clauses, &args, "p.emergency_id = $%d", queryValue(r, "emergency"))
	if search := queryValue(r, "search"); search != "" {
		args = append(args, "%"+search+"%")
		p := len(args)
		clauses = append(clauses, fmt.Sprintf("(s.name ILIKE $%d OR COALESCE(p.presentation_name,'') ILIKE $%d OR COALESCE(p.content_name,'') ILIKE $%d OR COALESCE(p.presentation_id,'') ILIKE $%d OR COALESCE(p.content_id,'') ILIKE $%d)", p, p, p, p, p))
	}
	return clauses, args, nil
}

func firstQueryValue(r *http.Request, keys ...string) string {
	for _, key := range keys {
		if value := queryValue(r, key); value != "" {
			return value
		}
	}
	return ""
}

func (s *server) proofOfPlaySummary(w http.ResponseWriter, r *http.Request) {
	window, err := parseActivityWindow(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_range_invalid", err.Error())
		return
	}
	clauses, args, err := proofClauses(r, window)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "proof_filter_invalid", err.Error())
		return
	}
	dimension := queryValue(r, "dimension")
	var keyExpression, labelExpression string
	switch dimension {
	case "content":
		keyExpression, labelExpression = "COALESCE(p.content_id,'presentation:'||COALESCE(p.presentation_id,''))", "COALESCE(NULLIF(p.content_name,''),NULLIF(p.presentation_name,''),'Unknown content')"
	case "presentation":
		keyExpression, labelExpression = "COALESCE(p.presentation_id,'')", "COALESCE(NULLIF(p.presentation_name,''),'Unknown presentation')"
	case "schedule":
		keyExpression, labelExpression = "COALESCE(p.schedule_id,'direct')", "COALESCE(NULLIF(p.schedule_id,''),'Direct assignment')"
	default:
		dimension = "screen"
		keyExpression, labelExpression = "p.screen_id::text", "s.name"
	}
	// Root and child durations are totalled separately. Root sessions are the
	// screen's wall clock; child sessions are exposure and can overlap, so the
	// two must never be added together into one "confirmed playback" number.
	interrupted := len(args) + 1
	args = append(args, interruptedTerminalReasons())
	rows, err := s.db.Query(r.Context(), `
		SELECT `+keyExpression+`,`+labelExpression+`,
		       COALESCE(sum(p.actual_duration_ms) FILTER(WHERE p.session_type='presentation' AND p.result IN('completed','recovered','partial')),0)::bigint,
		       COALESCE(sum(p.actual_duration_ms) FILTER(WHERE p.session_type<>'presentation' AND p.result IN('completed','recovered','partial')),0)::bigint,
		       count(*)::bigint,count(*) FILTER(WHERE p.result='completed')::bigint,
		       count(*) FILTER(WHERE p.result='failed')::bigint,count(*) FILTER(WHERE p.result='partial')::bigint,
		       count(*) FILTER(WHERE p.result='unknown')::bigint,
		       count(*) FILTER(WHERE p.terminal_reason = ANY($`+strconv.Itoa(interrupted)+`))::bigint
		FROM playback_sessions p JOIN screens s ON s.id=p.screen_id
		WHERE `+strings.Join(clauses, " AND ")+`
		GROUP BY 1,2 ORDER BY 3 DESC,4 DESC,2 LIMIT 250`, args...)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []proofSummaryItem{}
	for rows.Next() {
		var item proofSummaryItem
		if rows.Scan(&item.Key, &item.Label, &item.ConfirmedScreenPlaybackMS, &item.ContentExposureMS, &item.Records, &item.Completed, &item.Failures, &item.Partial, &item.Unknown, &item.Interrupted) != nil {
			continue
		}
		if item.Records > 0 {
			item.SessionCompletionPercent = float64(item.Completed+item.Partial) / float64(item.Records) * 100
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"dimension": dimension, "items": items}})
}

func (s *server) exportProofOfPlay(w http.ResponseWriter, r *http.Request) {
	if !activityCanExport(activitySession(r).User.Role) {
		writeError(w, http.StatusForbidden, "activity_export_restricted", "Activity exports require Owner or Administrator access.")
		return
	}
	window, err := parseActivityWindow(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_range_invalid", err.Error())
		return
	}
	clauses, args, err := proofClauses(r, window)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "proof_filter_invalid", err.Error())
		return
	}
	rows, err := s.db.Query(r.Context(), proofSelectSQL+` WHERE `+strings.Join(clauses, " AND ")+` ORDER BY p.started_at DESC,p.id DESC LIMIT 50000`, args...)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="tilecast-proof-of-play.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"Started at", "Ended at", "Screen", "Group", "Session type", "Presentation", "Presentation type", "Revision", "Content", "Content type", "Playlist item ID", "Layout placement ID", "Actual duration ms", "Expected duration ms", "Result", "Terminal reason", "Trigger", "Schedule ID", "Emergency ID", "Manifest version", "Failure code", "Source ID", "Selected record ID", "Selection date", "Source cached at", "Source revision", "Snapshot hash"})
	for rows.Next() {
		item, err := scanProof(rows.Scan, "owner")
		if err != nil {
			continue
		}
		_ = writer.Write([]string{
			item.StartedAt.UTC().Format(time.RFC3339), optionalTime(item.EndedAt), item.ScreenName, item.GroupName, item.SessionType,
			firstNonEmpty(item.PresentationName, item.PresentationID), item.PresentationType, item.PresentationRevision,
			firstNonEmpty(item.ContentName, item.ContentID), item.ContentType, item.PlaylistItemID, item.LayoutPlacementID,
			optionalInt64(item.ActualDurationMS), optionalInt64(item.ExpectedDurationMS), item.Result, item.TerminalReason, item.Trigger,
			item.ScheduleID, item.EmergencyID, optionalInt64(item.ManifestVersion), item.FailureCode, item.SourceID,
			item.SelectedRecordID, optionalDate(item.SelectionDate), optionalTime(item.SourceCachedAt), item.SourceRevision, item.SnapshotHash,
		})
	}
	writer.Flush()
}
