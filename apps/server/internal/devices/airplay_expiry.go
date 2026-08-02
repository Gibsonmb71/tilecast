package devices

import (
	"context"

	"github.com/google/uuid"
)

// ExpireAirplaySessions is the server-side deadline enforcement path. Linux
// players also enforce the same absolute deadline locally, but the server must
// not leave an expired session, temporary identity, or prepare command looking
// active when a player is offline and cannot send a final heartbeat.
func (s *Service) ExpireAirplaySessions(ctx context.Context) {
	rows, err := s.db.Query(ctx, `SELECT id FROM external_presentation_sessions WHERE status='stopping' OR (status IN ('preparing','waiting','active') AND expires_at<=now())`)
	if err != nil {
		return
	}
	// Materialize the work list before opening a transaction for any session.
	// Keeping a pool connection occupied by the query while each cleanup tries
	// to acquire another one can starve a small pool during startup recovery.
	sessionIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var sessionID uuid.UUID
		if rows.Scan(&sessionID) != nil {
			rows.Close()
			return
		}
		sessionIDs = append(sessionIDs, sessionID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return
	}
	rows.Close()
	for _, sessionID := range sessionIDs {
		s.expireAirplaySession(ctx, sessionID)
	}
}

func (s *Service) expireAirplaySession(ctx context.Context, sessionID uuid.UUID) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)

	// Re-check the status inside the transaction so a concurrent Studio stop or
	// player failure transition wins without being overwritten by this worker.
	// A stopping row is also eligible even when its original deadline is in the
	// future: it may be the durable remainder of a server process that exited
	// between marking the session stopping and inserting cleanup commands.
	tag, err := tx.Exec(ctx, `UPDATE external_presentation_sessions SET
		status=CASE WHEN status='stopping' THEN 'ended' ELSE 'expired' END,
		ended_at=COALESCE(ended_at,now()),
		end_reason=COALESCE(end_reason,CASE WHEN status='stopping' THEN 'stopped' ELSE 'expired' END),
		pin=NULL,device_id=NULL
		WHERE id=$1 AND (status='stopping' OR (status IN ('preparing','waiting','active') AND expires_at<=now()))`, sessionID)
	if err != nil || tag.RowsAffected() == 0 {
		return
	}
	var stopReason string
	if err := tx.QueryRow(ctx, `SELECT COALESCE(end_reason,'expired') FROM external_presentation_sessions WHERE id=$1`, sessionID).Scan(&stopReason); err != nil {
		return
	}
	var organizationID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT organization_id FROM external_presentation_sessions WHERE id=$1`, sessionID).Scan(&organizationID); err != nil {
		return
	}
	memberRows, err := tx.Query(ctx, `SELECT screen_id FROM external_presentation_screen_states WHERE session_id=$1`, sessionID)
	if err != nil {
		return
	}
	screens := []uuid.UUID{}
	for memberRows.Next() {
		var screenID uuid.UUID
		if memberRows.Scan(&screenID) == nil {
			screens = append(screens, screenID)
		}
	}
	memberRows.Close()
	if memberRows.Err() != nil {
		return
	}
	_, _ = tx.Exec(ctx, `UPDATE external_presentation_screen_states SET state='stopped',last_updated_at=now(),failure_code=NULL,safe_failure_message=NULL WHERE session_id=$1`, sessionID)
	_, _ = tx.Exec(ctx, `UPDATE player_commands SET state='cancelled',completed_at=now(),updated_at=now(),safe_result_code=CASE WHEN $2='expired' THEN 'airplay_expired' ELSE 'airplay_session_stopped' END,safe_result_message=CASE WHEN $2='expired' THEN 'The AirPlay session expired before this command was delivered.' ELSE 'The AirPlay session ended before this command was delivered.' END,payload='{}'::jsonb WHERE type='prepare_airplay_session' AND payload->>'sessionId'=$1 AND state IN ('pending','delivered','acknowledged','running')`, sessionID.String(), stopReason)
	// Successful prepare commands are retained by the normal command-history
	// policy, but their temporary PIN/device payload must not survive the
	// external session's terminal transition.
	_, _ = tx.Exec(ctx, `UPDATE player_commands SET payload='{}'::jsonb WHERE type='prepare_airplay_session' AND payload->>'sessionId'=$1`, sessionID.String())
	_, _ = tx.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state=NULL,external_presentation_session_id=NULL,external_presentation_role=NULL,airplay_receiver_state=NULL,airplay_transport=NULL,airplay_connected=NULL,external_presentation_expires_at=NULL WHERE external_presentation_session_id=$1`, sessionID)
	for _, screenID := range screens {
		// The local player deadline is authoritative when offline, but an online
		// player should receive an explicit stop command as soon as the server
		// deadline worker closes the session. created_by is intentionally NULL:
		// this is a server-owned cleanup command, not a Studio user's action.
		_, _ = tx.Exec(ctx, `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,created_by,expires_at)
			SELECT $1,$2,$3,'stop_airplay_session',jsonb_build_object('sessionId',$4::text,'reason',$5::text),$6,NULL,now()+interval '5 minutes'
			WHERE NOT EXISTS(
				SELECT 1 FROM player_commands
				WHERE screen_id=$3 AND type='stop_airplay_session'
				  AND payload->>'sessionId'=$4
				  AND state IN ('pending','delivered','acknowledged','running')
			)`, uuid.New(), organizationID, screenID, sessionID.String(), stopReason, uuid.New())
	}
	if err = tx.Commit(ctx); err != nil {
		return
	}
	for _, screenID := range screens {
		if s.presence != nil {
			s.Notify(screenID, map[string]any{"type": "commands.available"})
			s.Notify(screenID, map[string]any{"type": "external_presentation.changed", "sessionId": sessionID})
		}
	}
}
