package devices

import (
	"context"

	"github.com/google/uuid"
)

var airplayExternalStates = map[string]bool{
	"preparing": true,
	"waiting":   true,
	"connected": true,
	"degraded":  true,
	"failed":    true,
	"none":      true,
}

// updateAirplayHeartbeat is deliberately best effort. AirPlay is an optional
// capability; a new status column or a malformed external-session identifier
// must never make a healthy player heartbeat fail authentication/liveness.
func (s *Service) updateAirplayHeartbeat(ctx context.Context, screenID uuid.UUID, heartbeat Heartbeat) {
	state := heartbeat.ExternalPresentationState
	if state != "" && !airplayExternalStates[state] {
		state = ""
	}
	// What the player *can* do is written unconditionally. It used to share the
	// session-ownership guard below, which deadlocked the feature: an idle
	// player reports externalPresentationState 'none' with no session id, that
	// guard matched no row, so capabilities were only ever stored while a
	// presentation was already running — and a presentation cannot be started
	// until Studio has seen the capabilities.
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET
		airplay_supported=COALESCE($2,airplay_supported),
		airplay_uxplay_version=COALESCE(NULLIF($3,''),airplay_uxplay_version),
		airplay_hardware_decode=COALESCE($4,airplay_hardware_decode),
		airplay_decoder=COALESCE(NULLIF($5,''),airplay_decoder),
		airplay_max_profile=COALESCE(NULLIF($6,''),airplay_max_profile),
		airplay_group_supported=COALESCE($7,airplay_group_supported),
		airplay_audio_available=COALESCE($8,airplay_audio_available),
		airplay_avahi_available=COALESCE($9,airplay_avahi_available),
		airplay_uxplay_installed=COALESCE($12,airplay_uxplay_installed),
		airplay_gstreamer_installed=COALESCE($13,airplay_gstreamer_installed),
		airplay_h264_decoder_available=COALESCE($14,airplay_h264_decoder_available),
		airplay_mdns_advertisement_available=COALESCE($15,airplay_mdns_advertisement_available),
		airplay_multicast_supported=COALESCE($10,airplay_multicast_supported),
		airplay_multicast_test_status=COALESCE(NULLIF($11,''),airplay_multicast_test_status)
		WHERE screen_id=$1`, screenID, heartbeat.AirplaySupported, heartbeat.AirplayUxPlayVersion,
		heartbeat.AirplayHardwareDecode, heartbeat.AirplayDecoder, heartbeat.AirplayMaxProfile,
		heartbeat.AirplayGroupSupported, heartbeat.AirplayAudioAvailable, heartbeat.AirplayAvahiAvailable,
		heartbeat.AirplayMulticastSupported, heartbeat.AirplayMulticastTestStatus,
		heartbeat.AirplayUxPlayInstalled, heartbeat.AirplayGstreamerInstalled,
		heartbeat.AirplayH264DecoderAvailable, heartbeat.AirplayMdnsAdvertisementAvailable)

	// Live session state stays guarded: a player may only clear or advance the
	// snapshot of a session it still owns, so a stale 'none' cannot wipe a
	// session that has since been handed to it.
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET
		external_presentation_state=CASE WHEN $2='' THEN external_presentation_state WHEN $2='none' THEN NULL ELSE $2 END,
		external_presentation_session_id=CASE WHEN $2='none' THEN NULL ELSE COALESCE($3,external_presentation_session_id) END,
		external_presentation_role=CASE WHEN $2='none' THEN NULL ELSE COALESCE(NULLIF($4,''),external_presentation_role) END,
		airplay_receiver_state=CASE WHEN $2='none' THEN NULL ELSE COALESCE(NULLIF($5,''),airplay_receiver_state) END,
		airplay_transport=CASE WHEN $2='none' THEN NULL ELSE COALESCE(NULLIF($6,''),airplay_transport) END,
		airplay_connected=CASE WHEN $2='none' THEN NULL ELSE COALESCE($7,airplay_connected) END,
		external_presentation_expires_at=CASE WHEN $2='none' THEN NULL ELSE COALESCE($8,external_presentation_expires_at) END
		WHERE screen_id=$1 AND ($2 <> 'none' OR ($3 IS NOT NULL AND external_presentation_session_id=$3))`,
		screenID, state, heartbeat.ExternalPresentationSessionID, heartbeat.ExternalPresentationRole,
		heartbeat.AirplayReceiverState, heartbeat.AirplayTransport, heartbeat.AirplayConnected,
		heartbeat.ExternalPresentationExpiresAt)

	if state == "" {
		return
	}
	if state == "none" {
		s.reconcileClearedAirplaySession(ctx, screenID, heartbeat.ExternalPresentationSessionID)
		return
	}
	if heartbeat.ExternalPresentationSessionID == nil {
		return
	}
	var sessionStatus string
	if err := s.db.QueryRow(ctx, `SELECT status FROM external_presentation_sessions WHERE id=$1`, *heartbeat.ExternalPresentationSessionID).Scan(&sessionStatus); err != nil {
		return
	}
	if sessionStatus == "ended" || sessionStatus == "expired" || sessionStatus == "failed" {
		// A heartbeat can race the server-side expiration/stop command. Do not
		// let that stale player snapshot repopulate the reliability row after the
		// session has become terminal. Queue a server-owned stop as well so a
		// player that recovered from local state cannot keep advertising it.
		_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state=NULL,external_presentation_session_id=NULL,external_presentation_role=NULL,airplay_receiver_state=NULL,airplay_transport=NULL,airplay_connected=NULL,external_presentation_expires_at=NULL WHERE screen_id=$1`, screenID)
		var organizationID uuid.UUID
		if s.db.QueryRow(ctx, `SELECT organization_id FROM screens WHERE id=$1`, screenID).Scan(&organizationID) == nil {
			_, _ = s.db.Exec(ctx, `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,created_by,expires_at) SELECT $1,$2,$3,'stop_airplay_session',jsonb_build_object('sessionId',$4::text,'reason','server_session_terminal'),$5,NULL,now()+interval '5 minutes' WHERE NOT EXISTS(SELECT 1 FROM player_commands WHERE screen_id=$3 AND type='stop_airplay_session' AND payload->>'sessionId'=$4 AND state IN ('pending','delivered','acknowledged','running'))`, uuid.New(), organizationID, screenID, (*heartbeat.ExternalPresentationSessionID).String(), uuid.New())
			s.Notify(screenID, map[string]any{"type": "commands.available"})
		}
		return
	}
	storedState := state
	if storedState == "none" {
		storedState = "stopped"
	}
	_, _ = s.db.Exec(ctx, `UPDATE external_presentation_screen_states SET state=$3,last_updated_at=now(),failure_code=CASE WHEN $3 IN ('failed','degraded') THEN failure_code ELSE NULL END,safe_failure_message=CASE WHEN $3 IN ('failed','degraded') THEN safe_failure_message ELSE NULL END WHERE session_id=$1 AND screen_id=$2`, *heartbeat.ExternalPresentationSessionID, screenID, storedState)
	// The gateway is the source of truth for the room/session lifecycle. A
	// follower heartbeat may be waiting, connected, or degraded independently;
	// allowing it to rewrite the session row would make an active group flap
	// back to waiting whenever a follower reports a later heartbeat.
	nextSessionStatus := map[string]string{
		"preparing": "preparing", "waiting": "waiting", "connected": "active",
		"degraded": "active", "failed": "failed",
	}[state]
	if nextSessionStatus != "" && (heartbeat.ExternalPresentationRole == "gateway" || heartbeat.ExternalPresentationRole == "single") {
		_, _ = s.db.Exec(ctx, `UPDATE external_presentation_sessions SET status=$2,ended_at=CASE WHEN $2='failed' THEN COALESCE(ended_at,now()) ELSE ended_at END,end_reason=CASE WHEN $2='failed' THEN COALESCE(end_reason,'player_reported_failure') ELSE end_reason END,pin=CASE WHEN $2='failed' THEN NULL ELSE pin END,device_id=CASE WHEN $2='failed' THEN NULL ELSE device_id END WHERE id=$1 AND status IN ('preparing','waiting','active','stopping')`, *heartbeat.ExternalPresentationSessionID, nextSessionStatus)
	}
}

func (s *Service) reconcileClearedAirplaySession(ctx context.Context, screenID uuid.UUID, sessionID *uuid.UUID) {
	if sessionID == nil {
		return
	}
	var role string
	if err := s.db.QueryRow(ctx, `SELECT role FROM external_presentation_screen_states WHERE session_id=$1 AND screen_id=$2`, *sessionID, screenID).Scan(&role); err != nil {
		return
	}
	if role != "gateway" && role != "single" {
		_, _ = s.db.Exec(ctx, `UPDATE external_presentation_screen_states SET state='stopped',last_updated_at=now(),failure_code='player_cleared_session',safe_failure_message='The player no longer has the external presentation session.' WHERE session_id=$1 AND screen_id=$2 AND state NOT IN ('stopped','failed')`, *sessionID, screenID)
		return
	}

	// A gateway disappearing is a room-level failure. Stop every participant,
	// not only the process that reported the clear, so followers cannot keep
	// showing the last forwarded frame after the source is gone.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE external_presentation_sessions SET status='failed',ended_at=COALESCE(ended_at,now()),end_reason=COALESCE(end_reason,'gateway_cleared_session'),pin=NULL,device_id=NULL WHERE id=$1 AND status IN ('preparing','waiting','active','stopping')`, *sessionID)
	if err != nil || tag.RowsAffected() == 0 {
		return
	}
	var organizationID uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT organization_id FROM external_presentation_sessions WHERE id=$1`, *sessionID).Scan(&organizationID); err != nil {
		return
	}
	memberRows, err := tx.Query(ctx, `SELECT screen_id FROM external_presentation_screen_states WHERE session_id=$1`, *sessionID)
	if err != nil {
		return
	}
	screens := []uuid.UUID{}
	for memberRows.Next() {
		var member uuid.UUID
		if memberRows.Scan(&member) == nil {
			screens = append(screens, member)
		}
	}
	memberRows.Close()
	if memberRows.Err() != nil {
		return
	}
	_, _ = tx.Exec(ctx, `UPDATE external_presentation_screen_states SET state='stopped',last_updated_at=now(),failure_code='gateway_cleared_session',safe_failure_message='The AirPlay gateway stopped; the room presentation was ended.' WHERE session_id=$1`, *sessionID)
	_, _ = tx.Exec(ctx, `UPDATE player_commands SET state='cancelled',completed_at=now(),updated_at=now(),safe_result_code='gateway_cleared_session',safe_result_message='The AirPlay gateway stopped before this session completed.' WHERE type='prepare_airplay_session' AND payload->>'sessionId'=$1 AND state IN ('pending','delivered','acknowledged','running')`, sessionID.String())
	_, _ = tx.Exec(ctx, `UPDATE player_commands SET payload='{}'::jsonb WHERE type='prepare_airplay_session' AND payload->>'sessionId'=$1`, sessionID.String())
	_, _ = tx.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state=NULL,external_presentation_session_id=NULL,external_presentation_role=NULL,airplay_receiver_state=NULL,airplay_transport=NULL,airplay_connected=NULL,external_presentation_expires_at=NULL WHERE external_presentation_session_id=$1`, *sessionID)
	for _, member := range screens {
		_, _ = tx.Exec(ctx, `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,created_by,expires_at) VALUES($1,$2,$3,'stop_airplay_session',jsonb_build_object('sessionId',$4::text,'reason','gateway_cleared_session'),$5,NULL,now()+interval '5 minutes')`, uuid.New(), organizationID, member, sessionID.String(), uuid.New())
	}
	if err = tx.Commit(ctx); err != nil {
		return
	}
	if s.presence != nil {
		for _, member := range screens {
			s.Notify(member, map[string]any{"type": "commands.available"})
			s.Notify(member, map[string]any{"type": "external_presentation.changed", "sessionId": *sessionID})
		}
	}
}
