package forms

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ProjectionWorker wakes forms at their next time-window boundary to re-project time-based views
// and auto-expire records that have passed their expiry. Forms are otherwise projected eagerly on
// mutation; this worker only handles the passage of time, so it polls infrequently.
type ProjectionWorker struct {
	service *Service
	logger  *slog.Logger
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	gate    func() bool
}

func NewProjectionWorker(service *Service, logger *slog.Logger) *ProjectionWorker {
	if logger == nil {
		logger = slog.Default()
	}
	return &ProjectionWorker{service: service, logger: logger}
}

// SetGate installs a check consulted before doing work; backup and restore pause the worker.
func (w *ProjectionWorker) SetGate(gate func() bool) { w.gate = gate }

func (w *ProjectionWorker) Start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	w.cancel = cancel
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			if w.gate != nil && !w.gate() {
				continue
			}
			if err := w.runDue(ctx); err != nil && ctx.Err() == nil {
				w.logger.Error("form projection tick failed", "error", err)
			}
		}
	}()
}

func (w *ProjectionWorker) Stop() {
	if w.cancel != nil {
		w.cancel()
	}
	w.wg.Wait()
}

// runDue rebuilds every form whose scheduled boundary has arrived.
func (w *ProjectionWorker) runDue(ctx context.Context) error {
	rows, err := w.service.db.Query(ctx, `SELECT rs.data_source_id FROM data_source_refresh_states rs
		JOIN data_sources ds ON ds.id=rs.data_source_id AND ds.deleted_at IS NULL AND ds.provider='form'
		WHERE rs.next_refresh_at<=now()`)
	if err != nil {
		return err
	}
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		if err := w.expireOverdue(ctx, id); err != nil {
			return err
		}
		if err := w.service.RebuildProjection(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

// expireOverdue moves output-eligible records past their expiry into the terminal "expired" state
// when the form defines one, and records the automatic transition in history.
func (w *ProjectionWorker) expireOverdue(ctx context.Context, formID uuid.UUID) error {
	var hasExpired bool
	if err := w.service.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM form_workflow_states WHERE data_source_id=$1 AND state_key='expired')`, formID).Scan(&hasExpired); err != nil {
		return err
	}
	if !hasExpired {
		return nil
	}
	rows, err := w.service.db.Query(ctx, `UPDATE form_records
		SET state_key='expired',eligible=FALSE,version=version+1,updated_at=now()
		WHERE data_source_id=$1 AND deleted_at IS NULL AND eligible AND expires_at IS NOT NULL AND expires_at<=now()
		RETURNING id`, formID)
	if err != nil {
		return err
	}
	defer rows.Close()
	expired := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return err
		}
		expired = append(expired, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range expired {
		_, _ = w.service.db.Exec(ctx, `INSERT INTO form_record_events(id,record_id,data_source_id,event_type,from_state,to_state,actor_name,note)
			VALUES($1,$2,$3,'transition','approved','expired','system','Automatically expired')`, uuid.New(), id, formID)
	}
	return nil
}
