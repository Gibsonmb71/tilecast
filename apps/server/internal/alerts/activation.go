package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

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
	// A rule read from the database always states its response mode; one built in
	// memory by an older caller may not, and a takeover is what it meant.
	responseMode := rule.ResponseMode
	if responseMode == "" {
		responseMode = "takeover"
	}
	ticker := responseMode == "ticker"
	var existing *uuid.UUID
	var shown displayedAlert
	err := s.db.QueryRow(ctx, `SELECT takeover_id,event,headline,area_description,instruction,severity,expires_at FROM alert_activations WHERE alert_id=$1 AND rule_id=$2 AND cleared_at IS NULL`,
		alertID, rule.ID).Scan(&existing, &shown.event, &shown.headline, &shown.areaDescription, &shown.instruction, &shown.severity, &shown.expiresAt)
	if err == nil {
		tx, beginErr := s.db.Begin(ctx)
		if beginErr != nil {
			return beginErr
		}
		defer tx.Rollback(ctx)
		expires := alertExpiry(alert, now, rule.MaximumDurationMinutes)
		_, err = tx.Exec(ctx, `UPDATE alert_activations SET event=$3,headline=$4,description=$5,instruction=$6,severity=$7,urgency=$8,certainty=$9,area_description=$10,sender=$11,effective_at=$12,expires_at=$13,last_seen_at=$14
			WHERE alert_id=$1 AND rule_id=$2`, alertID, rule.ID, alert.Event, alert.Headline, alert.Description, alert.Instruction, alert.Severity, alert.Urgency, alert.Certainty, alert.AreaDescription, alert.SenderName, alert.Effective, alertExpiry(alert, now, rule.MaximumDurationMinutes), now)
		if err != nil {
			return err
		}
		changed, updateErr := updateBuiltinAlertData(ctx, tx, rule, alert, expires, now)
		if updateErr != nil {
			return updateErr
		}
		screenIDs := []uuid.UUID{}
		// A bar carries the alert text and its expiry in the manifest itself, so
		// either only reaches the screen through a new manifest.
		if ticker && shown.differsFrom(alert, expires) {
			screenIDs, err = bumpRuleScreens(ctx, tx, rule.ID, now, "nws.alert.updated")
			if err != nil {
				return err
			}
		}
		if changed && existing != nil {
			rows, bumpErr := tx.Query(ctx, `WITH bumped AS (
				UPDATE screen_manifest_state manifest SET manifest_version=manifest_version+1,changed_at=$2,change_reason='nws.alert.updated'
				WHERE manifest.screen_id IN(SELECT screen_id FROM takeover_screen_states WHERE takeover_id=$1)
				RETURNING screen_id,manifest_version)
				UPDATE takeover_screen_states state SET manifest_version=bumped.manifest_version,last_updated_at=$2
				FROM bumped WHERE state.takeover_id=$1 AND state.screen_id=bumped.screen_id
				RETURNING state.screen_id`, *existing, now)
			if bumpErr != nil {
				return bumpErr
			}
			for rows.Next() {
				var screenID uuid.UUID
				if rows.Scan(&screenID) == nil {
					screenIDs = append(screenIDs, screenID)
				}
			}
			rows.Close()
			if err = rows.Err(); err != nil {
				return err
			}
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
		if len(screenIDs) > 0 {
			s.notify(ctx, screenIDs)
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	// A takeover cannot be raised without content to raise. A ticker has its
	// content in the manifest, so it has nothing to be missing.
	if !ticker && rule.PlaylistID == nil {
		return nil
	}
	expires := alertExpiry(alert, now, rule.MaximumDurationMinutes)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = updateBuiltinAlertData(ctx, tx, rule, alert, expires, now); err != nil {
		return err
	}
	var takeoverID *uuid.UUID
	var screenIDs []uuid.UUID
	if ticker {
		// The bar reaches the screen the same way a Countdown Bar does: a bumped
		// manifest, which the plugin channel then projects the activation into.
		// Nothing is taken over, so there is nothing to restore afterwards.
		if screenIDs, err = bumpRuleScreens(ctx, tx, rule.ID, now, "nws.ticker.activated"); err != nil {
			return err
		}
		if len(screenIDs) == 0 {
			return fmt.Errorf("alert rule has no eligible screens")
		}
		if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,action,resource_type,resource_id,metadata) VALUES($1,'nws_alert_ticker.activated','nws_alert_rule',$2,jsonb_build_object('alertId',$3::text,'event',$4::text))`,
			uuid.New(), rule.ID.String(), alertID, alert.Event); err != nil {
			return err
		}
	} else {
		raised, takeoverScreens, activateErr := s.activate(ctx, tx, rule, alert.Event, alert.Headline, alert.Description, now, expires)
		if activateErr != nil {
			return activateErr
		}
		takeoverID, screenIDs = &raised, takeoverScreens
	}
	_, err = tx.Exec(ctx, `INSERT INTO alert_activations(alert_id,rule_id,event,headline,description,instruction,severity,urgency,certainty,area_description,sender,effective_at,expires_at,response_mode,takeover_id,first_seen_at,last_seen_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
		ON CONFLICT(alert_id,rule_id) DO UPDATE SET event=EXCLUDED.event,headline=EXCLUDED.headline,description=EXCLUDED.description,instruction=EXCLUDED.instruction,severity=EXCLUDED.severity,urgency=EXCLUDED.urgency,certainty=EXCLUDED.certainty,area_description=EXCLUDED.area_description,sender=EXCLUDED.sender,effective_at=EXCLUDED.effective_at,expires_at=EXCLUDED.expires_at,response_mode=EXCLUDED.response_mode,takeover_id=EXCLUDED.takeover_id,last_seen_at=EXCLUDED.last_seen_at,cleared_at=NULL,clear_reason=NULL`,
		alertID, rule.ID, alert.Event, alert.Headline, alert.Description, alert.Instruction, alert.Severity, alert.Urgency, alert.Certainty, alert.AreaDescription, alert.SenderName, alert.Effective, expires, responseMode, takeoverID, now)
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(ctx, screenIDs)
	return nil
}

// displayedAlert is what an activation is currently putting on screen. A ticker
// publishes it in the manifest, so it is compared against the freshly polled
// alert to decide whether a new manifest is owed.
type displayedAlert struct {
	event           string
	headline        string
	areaDescription string
	instruction     string
	severity        string
	expiresAt       *time.Time
}

// differsFrom reports whether the polled alert would put anything new on screen.
//
// The expiry counts, because it is what a Player offline on a cached manifest
// uses to take the bar down: a warning the office extends has to reach the
// screen, not wait for the wording to change. It is compared only when the
// stored expiry is the publisher's own end — when the rule ceiling supplied it
// instead, the value is `now + maximum duration`, recomputed on every poll, and
// comparing that would re-push a manifest a minute for a bar that reads the same.
func (d displayedAlert) differsFrom(alert nwsProperties, expires time.Time) bool {
	if d.event != alert.Event || d.headline != alert.Headline ||
		d.areaDescription != alert.AreaDescription || d.instruction != alert.Instruction ||
		d.severity != alert.Severity {
		return true
	}
	end := alertEnd(alert)
	if end == nil || !expires.Equal(*end) {
		return false
	}
	return d.expiresAt == nil || !d.expiresAt.Equal(expires)
}

// bumpRuleScreens raises the manifest version of every screen a rule targets,
// directly or through a group, and reports the screens that must be told. A
// screen with no manifest state yet gets one: an alert must not be the request
// that finds a screen has never had a manifest and give up.
func bumpRuleScreens(ctx context.Context, tx pgx.Tx, ruleID uuid.UUID, now time.Time, reason string) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `WITH targeted AS (
		SELECT DISTINCT sc.id FROM alert_rule_targets t JOIN screens sc
			ON sc.deleted_at IS NULL AND (sc.id=t.screen_id OR EXISTS(
				SELECT 1 FROM screen_group_memberships m WHERE m.screen_group_id=t.screen_group_id AND m.screen_id=sc.id))
		WHERE t.rule_id=$1)
		INSERT INTO screen_manifest_state(screen_id,manifest_version,change_reason,changed_at)
		SELECT id,1,$3,$2 FROM targeted
		ON CONFLICT(screen_id) DO UPDATE SET previous_manifest_version=screen_manifest_state.manifest_version,
			manifest_version=screen_manifest_state.manifest_version+1,changed_at=$2,change_reason=$3
		RETURNING screen_id`, ruleID, now, reason)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	screenIDs := []uuid.UUID{}
	for rows.Next() {
		var screenID uuid.UUID
		if err = rows.Scan(&screenID); err != nil {
			return nil, err
		}
		screenIDs = append(screenIDs, screenID)
	}
	return screenIDs, rows.Err()
}

// ruleScreenIDs resolves a rule's targets without changing anything, for the
// cases that must know the screens before the targets themselves are gone.
func (s *Service) ruleScreenIDs(ctx context.Context, ruleID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.db.Query(ctx, `SELECT DISTINCT sc.id FROM alert_rule_targets t JOIN screens sc
		ON sc.deleted_at IS NULL AND (sc.id=t.screen_id OR EXISTS(
			SELECT 1 FROM screen_group_memberships m WHERE m.screen_group_id=t.screen_group_id AND m.screen_id=sc.id))
		WHERE t.rule_id=$1`, ruleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	screenIDs := []uuid.UUID{}
	for rows.Next() {
		var screenID uuid.UUID
		if err = rows.Scan(&screenID); err != nil {
			return nil, err
		}
		screenIDs = append(screenIDs, screenID)
	}
	return screenIDs, rows.Err()
}

func (s *Service) bumpScreens(ctx context.Context, screenIDs []uuid.UUID, reason string) error {
	if len(screenIDs) == 0 {
		return nil
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO screen_manifest_state(screen_id,manifest_version,change_reason)
		SELECT id,1,$2 FROM screens WHERE id=ANY($1) AND deleted_at IS NULL
		ON CONFLICT(screen_id) DO UPDATE SET previous_manifest_version=screen_manifest_state.manifest_version,
			manifest_version=screen_manifest_state.manifest_version+1,changed_at=now(),change_reason=$2`, screenIDs, reason); err != nil {
		return err
	}
	s.notify(ctx, screenIDs)
	return nil
}

// refreshRuleScreens re-publishes the manifest for a rule's current targets.
func (s *Service) refreshRuleScreens(ctx context.Context, ruleID uuid.UUID, reason string) error {
	screenIDs, err := s.ruleScreenIDs(ctx, ruleID)
	if err != nil {
		return err
	}
	return s.bumpScreens(ctx, screenIDs, reason)
}

// clearRuleActivations ends every live activation of one rule, whichever way it
// was answering: a takeover is cancelled and restored, a bar is withdrawn by
// republishing the manifest without it.
func (s *Service) clearRuleActivations(ctx context.Context, ruleID uuid.UUID, reason string) error {
	rows, err := s.db.Query(ctx, `SELECT alert_id,takeover_id FROM alert_activations WHERE rule_id=$1 AND cleared_at IS NULL`, ruleID)
	if err != nil {
		return err
	}
	type live struct {
		alertID    string
		takeoverID *uuid.UUID
	}
	items := []live{}
	for rows.Next() {
		var item live
		if err = rows.Scan(&item.alertID, &item.takeoverID); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}
	now := time.Now().UTC()
	withoutTakeover := false
	for _, item := range items {
		if item.takeoverID == nil {
			withoutTakeover = true
			continue
		}
		if err = s.cancelTakeover(ctx, *item.takeoverID, now); err != nil {
			return err
		}
	}
	if _, err = s.db.Exec(ctx, `UPDATE alert_activations SET cleared_at=$2,clear_reason=$3 WHERE rule_id=$1 AND cleared_at IS NULL`, ruleID, now, reason); err != nil {
		return err
	}
	if withoutTakeover {
		return s.refreshRuleScreens(ctx, ruleID, "nws.ticker.cleared")
	}
	return nil
}

func builtinAlertDocuments(alert nwsProperties, expires, updatedAt time.Time) (string, string) {
	messageParts := []string{}
	for _, value := range []string{alert.Event, alert.Headline, alert.AreaDescription, alert.Instruction} {
		value = strings.TrimSpace(value)
		if value != "" {
			messageParts = append(messageParts, value)
		}
	}
	message := strings.Join(messageParts, " — ")
	if message == "" {
		message = "Waiting for an active NWS alert"
	}
	expiresAt := ""
	if !expires.IsZero() {
		expiresAt = expires.UTC().Format(time.RFC3339)
	}
	configuration := map[string]any{
		"message": message, "severity": alert.Severity, "instructions": alert.Instruction,
		"contact": alert.SenderName, "expiresAt": expiresAt,
	}
	configJSON, _ := json.Marshal(configuration)
	fields := []map[string]string{
		{"key": "message", "label": "Message", "type": "text"},
		{"key": "severity", "label": "Severity", "type": "text"},
		{"key": "instructions", "label": "Instructions", "type": "text"},
		{"key": "contact", "label": "Contact", "type": "text"},
		{"key": "expiresAt", "label": "Expiration time", "type": "datetime"},
		{"key": "updatedAt", "label": "Updated time", "type": "datetime"},
	}
	values := map[string]string{
		"message": message, "severity": alert.Severity, "instructions": alert.Instruction,
		"contact": alert.SenderName, "expiresAt": expiresAt,
		"updatedAt": updatedAt.UTC().Format(time.RFC3339),
	}
	payload := map[string]any{"datasets": []any{map[string]any{
		"id": "object", "kind": "object", "fields": fields, "values": values,
		"cachedAt": updatedAt.UTC(), "staleAt": expires.UTC(),
	}}}
	payloadJSON, _ := json.Marshal(payload)
	return string(configJSON), string(payloadJSON)
}

func updateBuiltinAlertData(
	ctx context.Context,
	tx pgx.Tx,
	rule Rule,
	alert nwsProperties,
	expires, now time.Time,
) (bool, error) {
	// A ticker rule keeps no managed presentation even though it reads as
	// `builtin`: its text lives in the manifest, so there is no Data Source to
	// keep in step. Rules that once answered fullscreen may still carry managed
	// resource identifiers, and writing to them would be updating a snapshot
	// nothing is showing.
	if rule.ResponseMode == "ticker" || rule.PresentationMode != "builtin" || rule.ManagedDataSourceID == nil {
		return false, nil
	}
	configuration, payload := builtinAlertDocuments(alert, expires, now)
	tag, err := tx.Exec(ctx, `UPDATE data_sources SET configuration=$2::jsonb,updated_at=$3
		WHERE id=$1 AND system_managed=TRUE AND configuration IS DISTINCT FROM $2::jsonb`,
		*rule.ManagedDataSourceID, configuration, now)
	if err != nil || tag.RowsAffected() == 0 {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE data_source_refresh_states SET last_attempt_at=$2,last_success_at=$2,http_result_category='nws',parse_status='success',available_item_count=1,using_cached_data=FALSE,cache_updated_at=$2,cache_expires_at=$3,cached_payload=$4::jsonb,error_code=NULL,updated_at=$2 WHERE data_source_id=$1`,
		*rule.ManagedDataSourceID, now, expires, payload)
	return true, err
}

func bounded(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	for limit > 0 && !utf8.ValidString(value[:limit]) {
		limit--
	}
	return value[:limit]
}

// alertEnd is the end the publisher stated, if any. `ends` is the authoritative
// one when both are present.
func alertEnd(alert nwsProperties) *time.Time {
	if alert.Ends != nil {
		return alert.Ends
	}
	return alert.Expires
}

func alertExpiry(alert nwsProperties, now time.Time, maxMinutes int) time.Time {
	maximum := now.Add(time.Duration(maxMinutes) * time.Minute)
	candidate := alertEnd(alert)
	if candidate == nil || !candidate.After(now) || candidate.After(maximum) {
		return maximum
	}
	return *candidate
}

func (s *Service) activate(ctx context.Context, tx pgx.Tx, rule Rule, event, headline, description string, now, expires time.Time) (uuid.UUID, []uuid.UUID, error) {
	var err error
	if rule.PlaylistID == nil {
		return uuid.Nil, nil, fmt.Errorf("alert rule has no takeover playlist")
	}
	var organizationID uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT organization_id FROM playlists WHERE id=$1 AND deleted_at IS NULL`, *rule.PlaylistID).Scan(&organizationID); err != nil {
		return uuid.Nil, nil, fmt.Errorf("alert rule playlist is not ready")
	}
	if err = s.playlists.ValidatePresentationNowInTx(ctx, tx, "playlist", *rule.PlaylistID, now.UTC()); err != nil {
		return uuid.Nil, nil, err
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT s.id FROM screens s WHERE s.organization_id=$1 AND s.deleted_at IS NULL AND
		(s.id=ANY($2) OR EXISTS(SELECT 1 FROM screen_group_memberships m WHERE m.screen_id=s.id AND m.screen_group_id=ANY($3)))`, organizationID, rule.ScreenIDs, rule.GroupIDs)
	if err != nil {
		return uuid.Nil, nil, err
	}
	screenIDs := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return uuid.Nil, nil, err
		}
		screenIDs = append(screenIDs, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return uuid.Nil, nil, err
	}
	if len(screenIDs) == 0 {
		return uuid.Nil, nil, fmt.Errorf("alert rule has no eligible screens")
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
	detail = bounded(detail, 2000)
	_, err = tx.Exec(ctx, `INSERT INTO takeovers(id,organization_id,name,description,playlist_id,status,activated_at,expires_at) VALUES($1,$2,$3,$4,$5,'active',$6,$7)`, id, organizationID, name, detail, rule.PlaylistID, now, expires)
	if err != nil {
		return uuid.Nil, nil, err
	}
	for _, screenID := range uniqueUUIDs(rule.ScreenIDs) {
		if _, err = tx.Exec(ctx, `INSERT INTO takeover_targets(takeover_id,target_type,screen_id) VALUES($1,'screen',$2)`, id, screenID); err != nil {
			return uuid.Nil, nil, err
		}
	}
	for _, groupID := range uniqueUUIDs(rule.GroupIDs) {
		if _, err = tx.Exec(ctx, `INSERT INTO takeover_targets(takeover_id,target_type,screen_group_id) VALUES($1,'group',$2)`, id, groupID); err != nil {
			return uuid.Nil, nil, err
		}
	}
	for _, screenID := range screenIDs {
		if _, err = tx.Exec(ctx, `UPDATE takeover_screen_states state SET state='restored',restored_at=now(),last_updated_at=now() FROM takeovers takeover WHERE state.takeover_id=takeover.id AND state.screen_id=$1 AND takeover.status='active' AND state.state NOT IN ('restored','cancelled','expired')`, screenID); err != nil {
			return uuid.Nil, nil, err
		}
		var version int64
		if err = tx.QueryRow(ctx, `UPDATE screen_manifest_state SET manifest_version=manifest_version+1,changed_at=now(),change_reason='takeover.activated' WHERE screen_id=$1 RETURNING manifest_version`, screenID).Scan(&version); err != nil {
			return uuid.Nil, nil, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO takeover_screen_states(takeover_id,screen_id,manifest_version,state) VALUES($1,$2,$3,'pending')`, id, screenID, version); err != nil {
			return uuid.Nil, nil, err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,action,resource_type,resource_id,metadata) VALUES($1,'takeover.activated_by_nws','takeover',$2,jsonb_build_object('ruleId',$3::text,'event',$4::text))`, uuid.New(), id.String(), rule.ID, event); err != nil {
		return uuid.Nil, nil, err
	}
	return id, screenIDs, nil
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
		if err = rows.Scan(&item.alertID, &item.ruleID, &item.takeoverID); err != nil {
			rows.Close()
			return err
		}
		if !seen[item.alertID+"\x00"+item.ruleID.String()] {
			items = append(items, item)
		}
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
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
		// A cleared bar is only gone once the screens are handed a manifest that
		// no longer contains it. A cancelled takeover already republishes.
		if item.takeoverID == nil {
			if err = s.refreshRuleScreens(ctx, item.ruleID, "nws.ticker.cleared"); err != nil {
				return err
			}
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
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		screenIDs = append(screenIDs, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	for _, screenID := range screenIDs {
		if _, err = tx.Exec(ctx, `UPDATE screen_manifest_state SET manifest_version=manifest_version+1,changed_at=$2,change_reason='takeover.cancelled' WHERE screen_id=$1`, screenID, now); err != nil {
			return err
		}
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
		if err := s.db.QueryRow(ctx, `SELECT manifest_version FROM screen_manifest_state WHERE screen_id=$1`, screenID).Scan(&version); err != nil {
			if s.logger != nil {
				s.logger.Error("manifest notification could not read committed version", "screen_id", screenID, "error", err)
			}
			continue
		}
		s.devices.Notify(screenID, map[string]any{"type": "takeover.changed", "manifestVersion": version})
		s.devices.Notify(screenID, map[string]any{"type": "manifest.changed", "manifestVersion": version})
	}
}
