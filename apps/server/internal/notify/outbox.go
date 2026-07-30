package notify

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// StaleTransitionWindow bounds how far back the outbox will look. A server
// that was down for a week comes back to a table full of transitions nobody
// can act on any more; sending them would bury whatever is wrong right now.
// They are marked notified and left in Activity, where history belongs.
//
// It is measured against when Tilecast noticed the condition, not against when
// the condition began. Several sweeps deliberately backdate opened_at so that
// time-to-recover measures the outage: a Data Source stale for five days opens
// an incident dated five days ago. Judging freshness on that would silently
// drop exactly the notification the condition exists to produce.
const StaleTransitionWindow = 24 * time.Hour

type incidentTransition struct {
	incidentID  uuid.UUID
	kind        string // opened or recovered
	incidentTyp string
	severity    string
	title       string
	description string
	at          time.Time
	// noticedAt is when the row was written, which is what freshness is judged
	// against. It differs from at whenever a sweep backdates opened_at.
	noticedAt    time.Time
	screenID     *uuid.UUID
	screenName   string
	locationName string
}

// ScanIncidents turns incident state changes into notification events. It is
// the only producer of incident notifications, which is why both the ingest
// path and the offline sweep are covered without either of them knowing this
// package exists.
func (s *Service) ScanIncidents(ctx context.Context) (int, error) {
	transitions, err := s.pendingTransitions(ctx)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, transition := range transitions {
		fresh := time.Since(transition.noticedAt) <= StaleTransitionWindow
		if fresh {
			if err := s.Enqueue(ctx, transition.event()); err != nil {
				// Leave the transition unmarked so the next tick retries it.
				return count, err
			}
			count++
		}
		if err := s.markNotified(ctx, transition); err != nil {
			return count, err
		}
	}
	return count, nil
}

func (s *Service) pendingTransitions(ctx context.Context) ([]incidentTransition, error) {
	rows, err := s.db.Query(ctx, `
		SELECT i.id,'opened',i.incident_type,i.severity,i.title,i.description,i.opened_at,
		       i.created_at,
		       i.primary_screen_id,COALESCE(s.name,''),COALESCE(l.name,'')
		FROM incidents i
		LEFT JOIN screens s ON s.id=i.primary_screen_id
		LEFT JOIN locations l ON l.id=i.location_id
		WHERE i.notified_open_at IS NULL
		UNION ALL
		SELECT i.id,'recovered',i.incident_type,i.severity,i.title,
		       COALESCE(NULLIF(i.resolution_reason,''),'The condition ended.'),i.recovered_at,
		       GREATEST(i.recovered_at, i.updated_at),
		       i.primary_screen_id,COALESCE(s.name,''),COALESCE(l.name,'')
		FROM incidents i
		LEFT JOIN screens s ON s.id=i.primary_screen_id
		LEFT JOIN locations l ON l.id=i.location_id
		WHERE i.recovered_at IS NOT NULL AND i.notified_recovered_at IS NULL
		ORDER BY 7
		LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []incidentTransition
	for rows.Next() {
		var t incidentTransition
		if err := rows.Scan(&t.incidentID, &t.kind, &t.incidentTyp, &t.severity, &t.title,
			&t.description, &t.at, &t.noticedAt, &t.screenID, &t.screenName,
			&t.locationName); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) markNotified(ctx context.Context, transition incidentTransition) error {
	column := "notified_open_at"
	if transition.kind == "recovered" {
		column = "notified_recovered_at"
	}
	_, err := s.db.Exec(ctx,
		fmt.Sprintf(`UPDATE incidents SET %s=now() WHERE id=$1`, column), transition.incidentID)
	return err
}

// categoryForIncidentType keeps the subscription preferences meaningful: a
// person who asked about screens going dark should not also be signed up for
// every stale calendar feed, and the reverse.
func categoryForIncidentType(incidentType string) string {
	switch incidentType {
	case "data_source", "content":
		return CategoryContentHealth
	case "update":
		return CategoryUpdate
	default:
		return CategoryIncident
	}
}

func (t incidentTransition) event() Event {
	where := t.screenName
	if where != "" && t.locationName != "" {
		where += " (" + t.locationName + ")"
	}

	subject := t.title
	severity := t.severity
	floor := t.severity
	body := t.description
	if t.kind == "recovered" {
		subject = "Recovered: " + t.title
		// A recovery is never critical: it is the end of one. Sending it at the
		// original severity would wake somebody up to tell them it is fine.
		// The floor stays at the condition's severity so the people who were
		// told it started are also told it ended.
		severity = "info"
	}
	if where != "" {
		subject += " - " + where
		body = strings.TrimSpace(body + "\n\nScreen: " + where)
	}

	payload := map[string]any{
		"incidentId":   t.incidentID.String(),
		"incidentType": t.incidentTyp,
		"transition":   t.kind,
		"studioPath":   "/activity/incidents",
	}
	if t.screenID != nil {
		payload["screenId"] = t.screenID.String()
		payload["screenName"] = t.screenName
	}
	if t.locationName != "" {
		payload["location"] = t.locationName
	}

	return Event{
		Key:           "incident:" + t.incidentID.String() + ":" + t.kind,
		Category:      categoryForIncidentType(t.incidentTyp),
		Severity:      severity,
		FloorSeverity: floor,
		Subject:       subject,
		Body:          body,
		OccurredAt:    t.at,
		Payload:       payload,
		URL:           "/activity/incidents",
	}
}
