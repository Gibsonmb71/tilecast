package httpapi

import (
	"net/http"
	"time"
)

type incidentAnalytics struct {
	Range struct {
		From time.Time `json:"from"`
		To   time.Time `json:"to"`
	} `json:"range"`

	// Active is measured now; the counts below are measured over the range.
	Active   int64 `json:"activeIncidents"`
	Opened   int64 `json:"incidentsOpened"`
	Resolved int64 `json:"incidentsResolved"`

	// Null rather than zero when nothing recovered in the range: zero would
	// read as "recovery is instant", which is the opposite of no data.
	MeanTimeToRecoverSeconds   *float64 `json:"meanTimeToRecoverSeconds"`
	MedianTimeToRecoverSeconds *float64 `json:"medianTimeToRecoverSeconds"`
	LongestIncidentSeconds     *float64 `json:"longestIncidentSeconds"`
	LongestIncidentTitle       string   `json:"longestIncidentTitle,omitempty"`

	AutomaticRecoveries int64 `json:"automaticRecoveries"`
	ManualRecoveries    int64 `json:"manualRecoveries"`

	Recurring  []incidentRecurrence `json:"recurring"`
	ByScreen   []incidentBreakdown  `json:"byScreen"`
	ByLocation []incidentBreakdown  `json:"byLocation"`
	ByModel    []incidentBreakdown  `json:"byDeviceModel"`
	ByVersion  []incidentBreakdown  `json:"byPlayerVersion"`
	ByFailure  []incidentBreakdown  `json:"byFailureCode"`
	ByType     []incidentBreakdown  `json:"byType"`
}

type incidentBreakdown struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int64  `json:"count"`
}

type incidentRecurrence struct {
	ScreenID     string `json:"screenId,omitempty"`
	ScreenName   string `json:"screenName"`
	IncidentType string `json:"incidentType"`
	// Separate counts: five short outages and one outage reported five times
	// are different problems, and collapsing them would hide which it is.
	Incidents   int64 `json:"incidents"`
	Occurrences int64 `json:"occurrences"`
}

// Recovery duration is measured to whichever came first: the condition ending
// on its own, or a person closing it. Using resolved_at alone would blame the
// operator's response time on the fleet.
const incidentRecoveryDurationSQL = `
	SELECT EXTRACT(EPOCH FROM (LEAST(COALESCE(recovered_at,resolved_at),COALESCE(resolved_at,recovered_at)) - opened_at))::float8
	FROM incidents
	WHERE opened_at < $2 AND COALESCE(recovered_at,resolved_at) >= $1
	  AND COALESCE(recovered_at,resolved_at) IS NOT NULL
	  AND COALESCE(recovered_at,resolved_at) > opened_at
	  AND status <> 'ignored'`

func (s *server) incidentAnalytics(w http.ResponseWriter, r *http.Request) {
	window, err := parseActivityWindow(r)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "activity_range_invalid", err.Error())
		return
	}
	if err := s.syncOfflineIncidents(r.Context()); err != nil {
		s.internalError(w, r, err)
		return
	}
	var data incidentAnalytics
	data.Range.From, data.Range.To = window.From, window.To
	data.Recurring = []incidentRecurrence{}
	for _, list := range []*[]incidentBreakdown{
		&data.ByScreen, &data.ByLocation, &data.ByModel, &data.ByVersion, &data.ByFailure, &data.ByType,
	} {
		*list = []incidentBreakdown{}
	}

	if err := s.db.QueryRow(r.Context(), `
		SELECT
			count(*) FILTER (WHERE status IN('open','acknowledged')),
			count(*) FILTER (WHERE opened_at>=$1 AND opened_at<$2),
			count(*) FILTER (WHERE resolved_at>=$1 AND resolved_at<$2),
			count(*) FILTER (WHERE recovery_mode='automatic' AND COALESCE(recovered_at,resolved_at)>=$1 AND COALESCE(recovered_at,resolved_at)<$2),
			count(*) FILTER (WHERE recovery_mode='manual' AND COALESCE(recovered_at,resolved_at)>=$1 AND COALESCE(recovered_at,resolved_at)<$2)
		FROM incidents`, window.From, window.To).Scan(
		&data.Active, &data.Opened, &data.Resolved, &data.AutomaticRecoveries, &data.ManualRecoveries,
	); err != nil {
		s.internalError(w, r, err)
		return
	}

	// Mean and median together, because one long outage skews the mean and the
	// pair tells an operator whether the typical case matches the average.
	if err := s.db.QueryRow(r.Context(), `
		SELECT avg(seconds),percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds),max(seconds)
		FROM (`+incidentRecoveryDurationSQL+`) AS durations(seconds)`,
		window.From, window.To).Scan(
		&data.MeanTimeToRecoverSeconds, &data.MedianTimeToRecoverSeconds, &data.LongestIncidentSeconds,
	); err != nil {
		s.internalError(w, r, err)
		return
	}
	_ = s.db.QueryRow(r.Context(), `
		SELECT title FROM incidents
		WHERE opened_at < $2 AND COALESCE(recovered_at,resolved_at) >= $1
		  AND COALESCE(recovered_at,resolved_at) IS NOT NULL AND status <> 'ignored'
		ORDER BY COALESCE(recovered_at,resolved_at) - opened_at DESC LIMIT 1`,
		window.From, window.To).Scan(&data.LongestIncidentTitle)

	recurringRows, err := s.db.Query(r.Context(), `
		SELECT COALESCE(i.primary_screen_id::text,''),COALESCE(s.name,'Unknown screen'),i.incident_type,
		       count(*),sum(i.occurrence_count)
		FROM incidents i LEFT JOIN screens s ON s.id=i.primary_screen_id
		WHERE i.opened_at>=$1 AND i.opened_at<$2 AND i.status<>'ignored'
		GROUP BY 1,2,3 HAVING count(*)>1 OR sum(i.occurrence_count)>2
		ORDER BY count(*) DESC,sum(i.occurrence_count) DESC LIMIT 20`, window.From, window.To)
	if err == nil {
		defer recurringRows.Close()
		for recurringRows.Next() {
			var item incidentRecurrence
			if recurringRows.Scan(&item.ScreenID, &item.ScreenName, &item.IncidentType, &item.Incidents, &item.Occurrences) == nil {
				data.Recurring = append(data.Recurring, item)
			}
		}
	}

	breakdowns := []struct {
		target *[]incidentBreakdown
		key    string
		label  string
	}{
		{&data.ByScreen, "COALESCE(i.primary_screen_id::text,'')", "COALESCE(s.name,'Unknown screen')"},
		{&data.ByLocation, "COALESCE(i.location_id::text,'')", "COALESCE(l.name,'No location')"},
		{&data.ByModel, "i.device_model", "COALESCE(NULLIF(i.device_model,''),'Unknown model')"},
		{&data.ByVersion, "i.player_version", "COALESCE(NULLIF(i.player_version,''),'Unknown version')"},
		{&data.ByFailure, "i.failure_code", "COALESCE(NULLIF(i.failure_code,''),'No failure code')"},
		{&data.ByType, "i.incident_type", "i.incident_type"},
	}
	for _, breakdown := range breakdowns {
		rows, err := s.db.Query(r.Context(), `
			SELECT `+breakdown.key+`,`+breakdown.label+`,count(*)
			FROM incidents i
			LEFT JOIN screens s ON s.id=i.primary_screen_id
			LEFT JOIN locations l ON l.id=i.location_id
			WHERE i.opened_at>=$1 AND i.opened_at<$2 AND i.status<>'ignored'
			GROUP BY 1,2 ORDER BY 3 DESC,2 LIMIT 20`, window.From, window.To)
		if err != nil {
			continue
		}
		for rows.Next() {
			var item incidentBreakdown
			if rows.Scan(&item.Key, &item.Label, &item.Count) == nil {
				*breakdown.target = append(*breakdown.target, item)
			}
		}
		rows.Close()
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}
