package httpapi

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tilecast/tilecast/apps/server/internal/airplay"
)

// Group AirPlay preparation is a durable state machine, not a goroutine.
//
// The session, its participants, and its preparation deadline all live in
// PostgreSQL. Reconciliation reads that state and decides what happens next:
//
//	preparing + every participant ready       -> queue the gateway start once
//	preparing + a participant failed          -> fail the session
//	preparing + preparation deadline exceeded -> fail the session
//	waiting / active                          -> leave alone
//	stopping / terminal / expired             -> leave alone; cleanup owns it
//
// It is safe to run repeatedly, concurrently, and from any process: the
// session row is locked for the decision, and the gateway start command is
// inserted in the same transaction that moves the session out of 'preparing'.
// A server that dies mid-preparation therefore loses nothing but time.
type airplayReconcileAction int

const (
	airplayReconcileNothing airplayReconcileAction = iota
	airplayReconcileFail
	airplayReconcileStarted
)

type airplayReconcileOutcome struct {
	action  airplayReconcileAction
	reason  string
	actor   uuid.UUID
	screens []uuid.UUID
}

// airplayQuerier is the subset of pgx shared by the pool and a transaction, so
// the same session/participant reads serve both the request path and the
// locked reconciliation transaction.
type airplayQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// ReconcileAirplaySessions is the periodic and startup backstop. Every other
// trigger (session creation, command results, heartbeats) is an optimization
// that makes a healthy group advance immediately; this is what guarantees an
// interrupted one still resolves.
func (s *server) ReconcileAirplaySessions(ctx context.Context) {
	rows, err := s.db.Query(ctx, `SELECT id FROM external_presentation_sessions WHERE status='preparing' AND target_type='group' ORDER BY created_at`)
	if err != nil {
		return
	}
	// Materialize before reconciling: each session takes its own transaction,
	// and holding this cursor open would occupy a pool connection for the whole
	// sweep during startup recovery.
	sessionIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var sessionID uuid.UUID
		if rows.Scan(&sessionID) == nil {
			sessionIDs = append(sessionIDs, sessionID)
		}
	}
	rows.Close()
	if rows.Err() != nil {
		return
	}
	for _, sessionID := range sessionIDs {
		s.reconcileAirplaySession(ctx, sessionID)
	}
}

func (s *server) reconcileAirplaySession(ctx context.Context, sessionID uuid.UUID) {
	outcome, err := s.advanceAirplayPreparation(ctx, sessionID)
	if err != nil {
		s.logger.Warn("AirPlay reconciliation could not advance the session", "session_id", sessionID, "error", err)
		return
	}
	switch outcome.action {
	case airplayReconcileFail:
		// Failure runs outside the reconciliation transaction: it queues its own
		// cleanup commands and re-checks the status itself, so a concurrent stop
		// or expiry still wins.
		s.failAirplaySession(ctx, sessionID, outcome.actor, outcome.reason)
	case airplayReconcileStarted:
		s.logger.Info("AirPlay group preparation completed; gateway start queued", "session_id", sessionID)
		for _, screen := range outcome.screens {
			if s.devices != nil {
				s.devices.Notify(screen, map[string]any{"type": "commands.available"})
				s.devices.Notify(screen, map[string]any{"type": "external_presentation.changed", "sessionId": sessionID})
			}
		}
	}
}

// advanceAirplayPreparation makes the durable decision for one session. The
// caller performs any side effect that must not hold the session row lock.
func (s *server) advanceAirplayPreparation(ctx context.Context, sessionID uuid.UUID) (airplayReconcileOutcome, error) {
	// Read the runtime setting before opening the transaction. It uses a second
	// pool connection, and acquiring one while holding a session row lock is how
	// a small pool deadlocks itself during startup recovery.
	expiryMinutes := s.runtimeIntContext(ctx, "commands.default_expiry_minutes", s.operations.DefaultCommandExpiryMinutes)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return airplayReconcileOutcome{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// FOR UPDATE is what makes two concurrent reconciliations safe: the second
	// one blocks here and then observes the status the first one committed.
	var status, targetType string
	var createdBy *uuid.UUID
	var expired, preparationExpired bool
	// The fallback window applies only to a session created before
	// prepare_deadline_at existed. Every session created since carries its own
	// durable deadline, which already accounts for a Presentation Network.
	err = tx.QueryRow(ctx, `SELECT status,target_type,created_by,expires_at<=now(),
		COALESCE(prepare_deadline_at,created_at+make_interval(secs=>$2))<=now()
		FROM external_presentation_sessions WHERE id=$1 FOR UPDATE`, sessionID, airplay.PreparationWait.Seconds()).
		Scan(&status, &targetType, &createdBy, &expired, &preparationExpired)
	if errors.Is(err, pgx.ErrNoRows) {
		return airplayReconcileOutcome{}, nil
	}
	if err != nil {
		return airplayReconcileOutcome{}, err
	}
	// Only an unexpired group that is still preparing has anything to advance.
	// A single-screen session receives its start phase with the first command,
	// waiting/active is already past this gate, and stopping/terminal belongs to
	// the stop and expiry paths. Expiration outranks every preparation outcome.
	if status != "preparing" || targetType != "group" || expired {
		return airplayReconcileOutcome{}, nil
	}
	actor := uuid.Nil
	if createdBy != nil {
		actor = *createdBy
	}

	ready, failed, total, err := airplayPreparationCountsFrom(ctx, tx, sessionID)
	if err != nil {
		return airplayReconcileOutcome{}, err
	}
	switch {
	case failed > 0:
		return airplayReconcileOutcome{action: airplayReconcileFail, reason: "group_preparation_failed", actor: actor}, nil
	case total > 0 && ready == total:
		// fall through to the gateway start below
	case preparationExpired:
		return airplayReconcileOutcome{action: airplayReconcileFail, reason: "group_preparation_timeout", actor: actor}, nil
	default:
		return airplayReconcileOutcome{}, nil
	}

	record, err := getAirplayRecordFrom(ctx, tx, sessionID)
	if err != nil {
		return airplayReconcileOutcome{}, err
	}
	screens, err := airplaySessionScreensFrom(ctx, tx, sessionID)
	if err != nil {
		return airplayReconcileOutcome{}, err
	}
	if len(screens) == 0 {
		return airplayReconcileOutcome{action: airplayReconcileFail, reason: "group_membership_unavailable", actor: actor}, nil
	}
	validated, err := s.validateCommand("prepare_airplay_session", mustJSON(airplayCommandPayload(record, "gateway", "start", screens)))
	if err != nil {
		return airplayReconcileOutcome{action: airplayReconcileFail, reason: "gateway_command_invalid", actor: actor}, nil
	}
	if err = insertAirplayGatewayStart(ctx, tx, record, validated, actor, expiryMinutes); err != nil {
		return airplayReconcileOutcome{}, err
	}
	// Same transaction as the command insert. Either the room advances with a
	// durable start command behind it, or nothing changed and the next
	// reconciliation tries again.
	if _, err = tx.Exec(ctx, `UPDATE external_presentation_sessions SET status='waiting' WHERE id=$1 AND status='preparing'`, record.ID); err != nil {
		return airplayReconcileOutcome{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return airplayReconcileOutcome{}, err
	}
	members := make([]uuid.UUID, 0, len(screens))
	for _, screen := range screens {
		members = append(members, screen.ID)
	}
	return airplayReconcileOutcome{action: airplayReconcileStarted, screens: members}, nil
}

// insertAirplayGatewayStart writes the start command inside the reconciliation
// transaction. It deliberately does not go through queueCommand: the start is
// the second half of an activation the operator already authorized, it must not
// be refused by the per-screen pending-command quota, it must be atomic with
// the lifecycle transition above, and it must still work when the creating user
// has since been deleted.
func insertAirplayGatewayStart(ctx context.Context, tx pgx.Tx, record airplaySessionRecord, payload []byte, actor uuid.UUID, expiryMinutes int) error {
	var createdBy any
	if actor != uuid.Nil {
		createdBy = actor
	}
	var commandID uuid.UUID
	err := tx.QueryRow(ctx, `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,created_by,expires_at)
		SELECT $1,$2,$3,'prepare_airplay_session',$4::jsonb,$5,$6,now()+make_interval(mins=>$8)
		WHERE NOT EXISTS(
			SELECT 1 FROM player_commands
			WHERE screen_id=$3 AND type='prepare_airplay_session'
			  AND payload->>'sessionId'=$7 AND payload->>'phase'='start'
			  AND state IN ('pending','delivered','acknowledged','running','succeeded')
		) RETURNING id`, uuid.New(), record.OrganizationID, record.GatewayID, string(payload), uuid.New(), createdBy, record.ID.String(), expiryMinutes).Scan(&commandID)
	if errors.Is(err, pgx.ErrNoRows) {
		// A live gateway start already exists for this session. The lifecycle
		// transition below still applies; a second command would only duplicate it.
		return nil
	}
	if err != nil {
		return err
	}
	if actor != uuid.Nil {
		_, _ = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id) VALUES($1,$2,'command.created','player_command',$3)`, uuid.New(), actor, commandID.String())
	}
	return nil
}

func airplayPreparationCountsFrom(ctx context.Context, q airplayQuerier, sessionID uuid.UUID) (ready, failed, total int, err error) {
	err = q.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE state IN ('waiting','connected')),count(*) FILTER(WHERE state IN ('failed','degraded','stopped')) FROM external_presentation_screen_states WHERE session_id=$1`, sessionID).Scan(&total, &ready, &failed)
	return
}
