package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type complianceReport struct {
	Range struct {
		From time.Time `json:"from"`
		To   time.Time `json:"to"`
	} `json:"range"`

	// Expected screen-time that could be judged. Cancelled and
	// takeover-overridden time is excluded, because neither is playback that
	// went missing.
	MeasurableExpectedMS int64 `json:"measurableExpectedMs"`
	ConfirmedMS          int64 `json:"confirmedMs"`
	MissedMS             int64 `json:"missedMs"`
	// Null rather than zero when nothing measurable was expected. Zero would
	// read as total non-compliance instead of "nothing to measure".
	CompliancePercent *float64 `json:"compliancePercent"`

	// Time deliberately excluded, reported so the exclusion is visible rather
	// than silently improving the percentage.
	TakeoverOverriddenMS int64 `json:"takeoverOverriddenMs"`
	CancelledMS          int64 `json:"cancelledMs"`
	NotMeasurableMS      int64 `json:"notMeasurableMs"`

	Windows        int64 `json:"windows"`
	LateStarts     int64 `json:"lateStarts"`
	EarlyEndings   int64 `json:"earlyEndings"`
	NeverStarted   int64 `json:"neverStarted"`
	OfflineMisses  int64 `json:"offlineMisses"`
	FailedWindows  int64 `json:"failedWindows"`
	PartialWindows int64 `json:"partialWindows"`

	Breakdown []complianceBreakdown `json:"breakdown"`
	Dimension string                `json:"dimension"`
}

type complianceBreakdown struct {
	Key                  string   `json:"key"`
	Label                string   `json:"label"`
	MeasurableExpectedMS int64    `json:"measurableExpectedMs"`
	ConfirmedMS          int64    `json:"confirmedMs"`
	MissedMS             int64    `json:"missedMs"`
	CompliancePercent    *float64 `json:"compliancePercent"`
	Windows              int64    `json:"windows"`
	LateStarts           int64    `json:"lateStarts"`
	EarlyEndings         int64    `json:"earlyEndings"`
	NeverStarted         int64    `json:"neverStarted"`
	OfflineMisses        int64    `json:"offlineMisses"`
	// The most common reason time went missing in this group, or empty when
	// nothing was missed.
	TopFailureReason string `json:"topFailureReason,omitempty"`
}

// Expected milliseconds for a window, clipped to the reporting range. An open
// window is clipped at the range end rather than treated as infinite.
const expectedClippedMS = `
	GREATEST(0, EXTRACT(EPOCH FROM (
		LEAST(COALESCE(w.expected_end, $2::timestamptz), $2::timestamptz)
		- GREATEST(w.expected_start, $1::timestamptz)))*1000)::bigint`

// Cancelled, takeover-overridden and unmeasurable windows are excluded from
// the denominator; counting them would report an operator's own decision as a
// compliance failure.
const measurableFilter = `w.match_status NOT IN ('cancelled','overridden_by_takeover','not_measurable')`

var complianceDimensions = map[string][2]string{
	"screen":       {"w.screen_id::text", "COALESCE(s.name,'Unknown screen')"},
	"location":     {"COALESCE(s.location_id::text,'')", "COALESCE(l.name,'No location')"},
	"group":        {"COALESCE(g.id::text,'')", "COALESCE(g.name,'No group')"},
	"presentation": {"w.presentation_id", "COALESCE(NULLIF(w.presentation_id,''),'No presentation')"},
	"schedule":     {"w.schedule_id", "COALESCE(NULLIF(w.schedule_id,''),'Direct assignment')"},
	"date":         {"to_char(w.expected_start,'YYYY-MM-DD')", "to_char(w.expected_start,'YYYY-MM-DD')"},
	"reason":       {"w.match_status", "w.match_status"},
}

func (s *server) playbackCompliance(w http.ResponseWriter, r *http.Request) {
	window, err := parseActivityWindow(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_range_invalid", err.Error())
		return
	}
	// Judge everything that has finished before reporting on it, so a window
	// that closed a moment ago is not reported as unmeasured.
	if err := s.evaluateExpectedWindows(r.Context(), nil); err != nil {
		s.internalError(w, r, err)
		return
	}

	dimension := queryValue(r, "dimension")
	if dimension == "" {
		dimension = "screen"
	}
	expressions, ok := complianceDimensions[dimension]
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "compliance_dimension_invalid",
			"Dimension must be screen, location, group, presentation, schedule, date, or reason.")
		return
	}

	clauses := []string{"w.expected_start < $2", "COALESCE(w.expected_end,$2) > $1"}
	args := []any{window.From, window.To}
	if value := queryValue(r, "screen"); value != "" {
		id, err := uuid.Parse(value)
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, "screen_invalid", "Screen must be a UUID.")
			return
		}
		args = append(args, id)
		clauses = append(clauses, "w.screen_id = $"+strconv.Itoa(len(args)))
	}
	if value := queryValue(r, "schedule"); value != "" {
		args = append(args, value)
		clauses = append(clauses, "w.schedule_id = $"+strconv.Itoa(len(args)))
	}
	where := strings.Join(clauses, " AND ")

	var report complianceReport
	report.Range.From, report.Range.To = window.From, window.To
	report.Dimension = dimension
	report.Breakdown = []complianceBreakdown{}

	if err := s.db.QueryRow(r.Context(), `
		SELECT
			COALESCE(SUM(`+expectedClippedMS+`) FILTER (WHERE `+measurableFilter+`),0),
			COALESCE(SUM(w.confirmed_duration_ms) FILTER (WHERE `+measurableFilter+`),0),
			COALESCE(SUM(`+expectedClippedMS+`) FILTER (WHERE w.match_status='overridden_by_takeover'),0),
			COALESCE(SUM(`+expectedClippedMS+`) FILTER (WHERE w.match_status='cancelled'),0),
			COALESCE(SUM(`+expectedClippedMS+`) FILTER (WHERE w.match_status='not_measurable'),0),
			count(*),
			count(*) FILTER (WHERE w.match_status='started_late'),
			count(*) FILTER (WHERE w.match_status='ended_early'),
			count(*) FILTER (WHERE w.match_status='never_started'),
			count(*) FILTER (WHERE w.match_status='screen_offline'),
			count(*) FILTER (WHERE w.match_status='failed'),
			count(*) FILTER (WHERE w.match_status='partial')
		FROM expected_playback_windows w WHERE `+where, args...).Scan(
		&report.MeasurableExpectedMS, &report.ConfirmedMS,
		&report.TakeoverOverriddenMS, &report.CancelledMS, &report.NotMeasurableMS,
		&report.Windows, &report.LateStarts, &report.EarlyEndings,
		&report.NeverStarted, &report.OfflineMisses, &report.FailedWindows, &report.PartialWindows,
	); err != nil {
		s.internalError(w, r, err)
		return
	}
	report.MissedMS = max(0, report.MeasurableExpectedMS-report.ConfirmedMS)
	report.CompliancePercent = compliancePercent(report.ConfirmedMS, report.MeasurableExpectedMS)

	joins := `LEFT JOIN screens s ON s.id=w.screen_id
		LEFT JOIN locations l ON l.id=s.location_id`
	if dimension == "group" {
		joins += ` LEFT JOIN screen_group_memberships m ON m.screen_id=w.screen_id
			LEFT JOIN screen_groups g ON g.id=m.screen_group_id`
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT `+expressions[0]+`,`+expressions[1]+`,
			COALESCE(SUM(`+expectedClippedMS+`) FILTER (WHERE `+measurableFilter+`),0),
			COALESCE(SUM(w.confirmed_duration_ms) FILTER (WHERE `+measurableFilter+`),0),
			count(*),
			count(*) FILTER (WHERE w.match_status='started_late'),
			count(*) FILTER (WHERE w.match_status='ended_early'),
			count(*) FILTER (WHERE w.match_status='never_started'),
			count(*) FILTER (WHERE w.match_status='screen_offline'),
			COALESCE((array_agg(w.match_status ORDER BY `+expectedClippedMS+` DESC)
			          FILTER (WHERE w.match_status IN('never_started','screen_offline','failed','partial','started_late','ended_early')))[1],'')
		FROM expected_playback_windows w
		`+joins+`
		WHERE `+where+`
		GROUP BY 1,2 ORDER BY 3 DESC,2 LIMIT 200`, args...)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item complianceBreakdown
		if err := rows.Scan(&item.Key, &item.Label, &item.MeasurableExpectedMS, &item.ConfirmedMS,
			&item.Windows, &item.LateStarts, &item.EarlyEndings, &item.NeverStarted,
			&item.OfflineMisses, &item.TopFailureReason); err != nil {
			s.internalError(w, r, err)
			return
		}
		item.MissedMS = max(0, item.MeasurableExpectedMS-item.ConfirmedMS)
		item.CompliancePercent = compliancePercent(item.ConfirmedMS, item.MeasurableExpectedMS)
		report.Breakdown = append(report.Breakdown, item)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": report})
}

// compliancePercent is nil when nothing measurable was expected. Reporting 0%
// would say every expected play was missed, when in fact none was expected.
func compliancePercent(confirmed, expected int64) *float64 {
	if expected <= 0 {
		return nil
	}
	value := float64(confirmed) / float64(expected) * 100
	if value > 100 {
		// Playback beyond the window is still only full coverage of it.
		value = 100
	}
	return &value
}
