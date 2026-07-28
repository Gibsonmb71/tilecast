package alerts

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Service) applyAlert(ctx context.Context, alertID string, rule Rule, alert nwsProperties, now time.Time) error {
	alertID = bounded(alertID, 2048)
	alert.Event = bounded(alert.Event, 200)
	alert.Headline = bounded(alert.Headline, 1000)
	alert.Description = bounded(alert.Description, 8000)
	alert.Instruction = bounded(alert.Instruction, 4000)
	alert.Severity = bounded(alert.Severity, 32)
	alert.Urgency = bounded(alert.Urgency, 32)
	alert.Certainty = bounded(alert.Certainty, 32)
	alert.AreaDescription = bounded(alert.AreaDescription, 2000)
	alert.SenderName = bounded(alert.SenderName, 500)
	var existing *uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT takeover_id FROM alert_activations WHERE alert_id=$1 AND rule_id=$2 AND cleared_at IS NULL`, alertID, rule.ID).Scan(&existing)
	if err == nil {
		_, err = s.db.Exec(ctx, `UPDATE alert_activations SET headline=$3,description=$4,instruction=$5,severity=$6,urgency=$7,certainty=$8,area_description=$9,sender=$10,effective_at=$11,expires_at=$12,last_seen_at=$13
			WHERE alert_id=$1 AND rule_id=$2`, alertID, rule.ID, alert.Headline, alert.Description, alert.Instruction, alert.Severity, alert.Urgency, alert.Certainty, alert.AreaDescription, alert.SenderName, alert.Effective, alertExpiry(alert, now, rule.MaximumDurationMinutes), now)
		return err
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if rule.PlaylistID == nil {
		return nil
	}
	expires := alertExpiry(alert, now, rule.MaximumDurationMinutes)
	takeoverID, err := s.activate(ctx, rule, alert.Event, alert.Headline, alert.Description, now, expires)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO alert_activations(alert_id,rule_id,event,headline,description,instruction,severity,urgency,certainty,area_description,sender,effective_at,expires_at,response_mode,takeover_id,first_seen_at,last_seen_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'takeover',$14,$15,$15)
		ON CONFLICT(alert_id,rule_id) DO UPDATE SET event=EXCLUDED.event,headline=EXCLUDED.headline,description=EXCLUDED.description,instruction=EXCLUDED.instruction,severity=EXCLUDED.severity,urgency=EXCLUDED.urgency,certainty=EXCLUDED.certainty,area_description=EXCLUDED.area_description,sender=EXCLUDED.sender,effective_at=EXCLUDED.effective_at,expires_at=EXCLUDED.expires_at,takeover_id=EXCLUDED.takeover_id,last_seen_at=EXCLUDED.last_seen_at,cleared_at=NULL,clear_reason=NULL`,
		alertID, rule.ID, alert.Event, alert.Headline, alert.Description, alert.Instruction, alert.Severity, alert.Urgency, alert.Certainty, alert.AreaDescription, alert.SenderName, alert.Effective, expires, takeoverID, now)
	return err
}

func bounded(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func alertExpiry(alert nwsProperties, now time.Time, maxMinutes int) time.Time {
	maximum := now.Add(time.Duration(maxMinutes) * time.Minute)
	candidate := alert.Expires
	if alert.Ends != nil {
		candidate = alert.Ends
	}
	if candidate == nil || !candidate.After(now) || candidate.After(maximum) {
		return maximum
	}
	return *candidate
}

func (s *Service) activate(ctx context.Context, rule Rule, event, headline, description string, now, expires time.Time) (uuid.UUID, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	var organizationID uuid.UUID
	var ready bool
	if err = tx.QueryRow(ctx, `SELECT organization_id,(deleted_at IS NULL AND EXISTS(SELECT 1 FROM playlist_items WHERE playlist_id=playlists.id)) FROM playlists WHERE id=$1`, rule.PlaylistID).Scan(&organizationID, &ready); err != nil || !ready {
		return uuid.Nil, fmt.Errorf("alert rule playlist is not ready")
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT s.id FROM screens s WHERE s.organization_id=$1 AND s.deleted_at IS NULL AND
		(s.id=ANY($2) OR EXISTS(SELECT 1 FROM screen_group_memberships m WHERE m.screen_id=s.id AND m.screen_group_id=ANY($3)))`, organizationID, rule.ScreenIDs, rule.GroupIDs)
	if err != nil {
		return uuid.Nil, err
	}
	screenIDs := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if rows.Scan(&id) == nil {
			screenIDs = append(screenIDs, id)
		}
	}
	rows.Close()
	if len(screenIDs) == 0 {
		return uuid.Nil, fmt.Errorf("alert rule has no eligible screens")
	}
	id := uuid.New()
	name := event
	if name == "" {
		name = "NWS alert"
	}
	detail := headline
	if detail == "" {
		detail = description
	}
	if len(detail) > 2000 {
		detail = detail[:2000]
	}
	_, err = tx.Exec(ctx, `INSERT INTO takeovers(id,organization_id,name,description,playlist_id,status,activated_at,expires_at) VALUES($1,$2,$3,$4,$5,'active',$6,$7)`, id, organizationID, name, detail, rule.PlaylistID, now, expires)
	if err != nil {
		return uuid.Nil, err
	}
	for _, screenID := range uniqueUUIDs(rule.ScreenIDs) {
		_, _ = tx.Exec(ctx, `INSERT INTO takeover_targets(takeover_id,target_type,screen_id) VALUES($1,'screen',$2)`, id, screenID)
	}
	for _, groupID := range uniqueUUIDs(rule.GroupIDs) {
		_, _ = tx.Exec(ctx, `INSERT INTO takeover_targets(takeover_id,target_type,screen_group_id) VALUES($1,'group',$2)`, id, groupID)
	}
	for _, screenID := range screenIDs {
		_, _ = tx.Exec(ctx, `UPDATE takeover_screen_states state SET state='restored',restored_at=now(),last_updated_at=now() FROM takeovers takeover WHERE state.takeover_id=takeover.id AND state.screen_id=$1 AND takeover.status='active' AND state.state NOT IN ('restored','cancelled','expired')`, screenID)
		var version int64
		if err = tx.QueryRow(ctx, `UPDATE screen_manifest_state SET manifest_version=manifest_version+1,changed_at=now(),change_reason='takeover.activated' WHERE screen_id=$1 RETURNING manifest_version`, screenID).Scan(&version); err != nil {
			return uuid.Nil, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO takeover_screen_states(takeover_id,screen_id,manifest_version,state) VALUES($1,$2,$3,'pending')`, id, screenID, version); err != nil {
			return uuid.Nil, err
		}
	}
	_, _ = tx.Exec(ctx, `INSERT INTO audit_logs(id,action,resource_type,resource_id,metadata) VALUES($1,'takeover.activated_by_nws','takeover',$2,jsonb_build_object('ruleId',$3,'event',$4))`, uuid.New(), id.String(), rule.ID, event)
	if err = tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	s.notify(ctx, screenIDs)
	return id, nil
}

func (s *Service) clearMissing(ctx context.Context, seen map[string]bool, now time.Time) error {
	rows, err := s.db.Query(ctx, `SELECT alert_id,rule_id,takeover_id FROM alert_activations WHERE cleared_at IS NULL`)
	if err != nil {
		return err
	}
	type missing struct {
		alertID    string
		ruleID     uuid.UUID
		takeoverID *uuid.UUID
	}
	items := []missing{}
	for rows.Next() {
		var item missing
		if rows.Scan(&item.alertID, &item.ruleID, &item.takeoverID) == nil && !seen[item.alertID+"\x00"+item.ruleID.String()] {
			items = append(items, item)
		}
	}
	rows.Close()
	for _, item := range items {
		if item.takeoverID != nil {
			if err = s.cancelTakeover(ctx, *item.takeoverID, now); err != nil {
				return err
			}
		}
		_, err = s.db.Exec(ctx, `UPDATE alert_activations SET cleared_at=$3,clear_reason='no_longer_active' WHERE alert_id=$1 AND rule_id=$2 AND cleared_at IS NULL`, item.alertID, item.ruleID, now)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) cancelTakeover(ctx context.Context, takeoverID uuid.UUID, now time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE takeovers SET status='cancelled',cancelled_at=$2,cancellation_reason='NWS alert is no longer active',updated_at=$2 WHERE id=$1 AND status='active'`, takeoverID, now)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	rows, err := tx.Query(ctx, `UPDATE takeover_screen_states SET state='cancelled',restored_at=$2,last_updated_at=$2 WHERE takeover_id=$1 AND state NOT IN ('restored','cancelled','expired') RETURNING screen_id`, takeoverID, now)
	if err != nil {
		return err
	}
	screenIDs := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if rows.Scan(&id) == nil {
			screenIDs = append(screenIDs, id)
		}
	}
	rows.Close()
	for _, screenID := range screenIDs {
		_, _ = tx.Exec(ctx, `UPDATE screen_manifest_state SET manifest_version=manifest_version+1,changed_at=$2,change_reason='takeover.cancelled' WHERE screen_id=$1`, screenID, now)
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(ctx, screenIDs)
	return nil
}

func (s *Service) notify(ctx context.Context, screenIDs []uuid.UUID) {
	for _, screenID := range screenIDs {
		var version int64
		_ = s.db.QueryRow(ctx, `SELECT manifest_version FROM screen_manifest_state WHERE screen_id=$1`, screenID).Scan(&version)
		s.devices.Notify(screenID, map[string]any{"type": "takeover.changed", "manifestVersion": version})
		s.devices.Notify(screenID, map[string]any{"type": "manifest.changed", "manifestVersion": version})
	}
}
