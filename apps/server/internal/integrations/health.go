package integrations

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// FleetHealth is the bounded summary an external monitoring system can read.
//
// It is counts, not a report. The intent is that an installation's existing
// monitoring can alert on "screens offline > 0" without Tilecast growing a
// second reporting surface that has to agree with Activity. Anything that needs
// per-screen detail, history, or proof of play belongs in Activity, where the
// metric definitions are documented and load-bearing.
type FleetHealth struct {
	GeneratedAt time.Time `json:"generatedAt"`
	Screens     struct {
		Total int `json:"total"`
		// Recent means contacted within the last two minutes. There is
		// deliberately no "online" count here: live presence lives in the
		// process-local socket hub, which a database read cannot see, and a
		// number that looked like presence but was not would be worse than
		// none. Studio remains the authority on per-screen status.
		Recent   int `json:"recent"`
		Stale    int `json:"stale"`
		Offline  int `json:"offline"`
		Disabled int `json:"disabled"`
	} `json:"screens"`
	Incidents struct {
		Open         int            `json:"open"`
		Acknowledged int            `json:"acknowledged"`
		BySeverity   map[string]int `json:"bySeverity"`
	} `json:"incidents"`
	Content struct {
		StaleDataSources int `json:"staleDataSources"`
		EmptyPlaylists   int `json:"emptyPlaylists"`
	} `json:"content"`
}

// Status thresholds mirror internal/devices/status.go. They are duplicated
// nowhere else: this query derives the same buckets from last contact, because a
// monitoring system reading "stale" must mean what Studio means by it.
const (
	recentWindow = 2 * time.Minute
	staleWindow  = 15 * time.Minute
)

// Health reads the current fleet summary.
func (s *Service) Health(ctx context.Context) (FleetHealth, error) {
	health := FleetHealth{GeneratedAt: time.Now().UTC()}
	health.Incidents.BySeverity = map[string]int{}

	// A screen with no active credential is not counted at all: it is not a
	// screen that can be online or offline, it is one that has been retired.
	err := s.db.QueryRow(ctx, `
		SELECT
			count(*),
			count(*) FILTER (WHERE enabled AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at >= now()-$1::interval),
			count(*) FILTER (WHERE enabled AND last_heartbeat_at IS NOT NULL
			                 AND last_heartbeat_at < now()-$1::interval
			                 AND last_heartbeat_at >= now()-$2::interval),
			count(*) FILTER (WHERE enabled AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now()-$2::interval)),
			count(*) FILTER (WHERE NOT enabled)
		FROM screens sc
		WHERE sc.deleted_at IS NULL AND sc.archived_at IS NULL
		  AND EXISTS(SELECT 1 FROM device_credentials c
		             WHERE c.screen_id=sc.id AND c.revoked_at IS NULL)`,
		recentWindow, staleWindow).
		Scan(&health.Screens.Total, &health.Screens.Recent,
			&health.Screens.Stale, &health.Screens.Offline, &health.Screens.Disabled)
	if err != nil {
		return FleetHealth{}, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT status, severity, count(*)
		FROM incidents WHERE status IN ('open','acknowledged')
		GROUP BY status, severity`)
	if err != nil {
		return FleetHealth{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var status, severity string
		var count int
		if err := rows.Scan(&status, &severity, &count); err != nil {
			return FleetHealth{}, err
		}
		if status == "open" {
			health.Incidents.Open += count
		} else {
			health.Incidents.Acknowledged += count
		}
		health.Incidents.BySeverity[severity] += count
	}
	if err := rows.Err(); err != nil {
		return FleetHealth{}, err
	}

	// Content health counts come from the incidents that sweep maintains, so
	// this surface and the Content Health page cannot disagree.
	if err := s.db.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE incident_type='data_source'),
			count(*) FILTER (WHERE incident_type='content')
		FROM incidents WHERE status IN ('open','acknowledged')`).
		Scan(&health.Content.StaleDataSources, &health.Content.EmptyPlaylists); err != nil {
		return FleetHealth{}, err
	}
	return health, nil
}

// Prometheus renders the same numbers in the text exposition format, so an
// installation that already runs Prometheus does not need a JSON shim.
func (h FleetHealth) Prometheus() string {
	var b strings.Builder
	metric := func(name, help, kind string, labelled map[string]int) {
		fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, kind)
		keys := make([]string, 0, len(labelled))
		for key := range labelled {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if key == "" {
				fmt.Fprintf(&b, "%s %d\n", name, labelled[key])
				continue
			}
			fmt.Fprintf(&b, "%s{%s} %d\n", name, key, labelled[key])
		}
	}

	metric("tilecast_screens", "Screens with an active player credential, by reporting state.", "gauge", map[string]int{
		`state="recent"`:   h.Screens.Recent,
		`state="stale"`:    h.Screens.Stale,
		`state="offline"`:  h.Screens.Offline,
		`state="disabled"`: h.Screens.Disabled,
	})
	metric("tilecast_screens_total", "Screens with an active player credential.", "gauge",
		map[string]int{"": h.Screens.Total})

	severities := map[string]int{}
	for severity, count := range h.Incidents.BySeverity {
		severities[fmt.Sprintf("severity=%q", severity)] = count
	}
	if len(severities) == 0 {
		// An empty metric family reads as "no data" in Prometheus, which is not
		// the same as zero incidents. Emit the zero explicitly.
		severities[`severity="warning"`] = 0
	}
	metric("tilecast_incidents_unresolved", "Incidents that are open or acknowledged.", "gauge", severities)

	metric("tilecast_content_problems", "Unresolved content health conditions.", "gauge", map[string]int{
		`kind="stale_data_source"`: h.Content.StaleDataSources,
		`kind="empty_playlist"`:    h.Content.EmptyPlaylists,
	})
	return b.String()
}
