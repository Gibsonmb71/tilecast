package notify

import (
	"context"
	"log/slog"
	"time"
)

// ConditionSweeper derives conditions from current state rather than from
// events. Content health is one: nothing sends an event when a feed quietly
// stops refreshing, so the condition has to be looked for.
type ConditionSweeper interface {
	Sweep(ctx context.Context) error
}

// Worker drives the outbox: it sweeps for conditions, scans for state changes
// worth reporting, sends what is due, and applies retention to the delivery
// log.
type Worker struct {
	svc      *Service
	logger   *slog.Logger
	gate     func() bool
	sweepers []ConditionSweeper

	cancel context.CancelFunc
	done   chan struct{}
}

// NewWorker creates the notification worker.
func NewWorker(svc *Service, logger *slog.Logger) *Worker {
	return &Worker{svc: svc, logger: logger}
}

// AddSweeper registers a condition sweeper. Sweepers run before the outbox
// scan so a condition found this tick is reported in the same tick.
func (w *Worker) AddSweeper(sweeper ConditionSweeper) {
	w.sweepers = append(w.sweepers, sweeper)
}

// SetGate installs the backup guard, so a restore in progress is not
// interrupted by a worker writing to tables that are being swapped.
func (w *Worker) SetGate(gate func() bool) { w.gate = gate }

// Start launches the worker goroutine.
func (w *Worker) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	w.cancel = cancel
	w.done = make(chan struct{})
	go w.run(ctx)
}

// Stop cancels the worker and waits for it to exit.
func (w *Worker) Stop() {
	if w.cancel != nil {
		w.cancel()
	}
	if w.done != nil {
		<-w.done
	}
}

func (w *Worker) run(ctx context.Context) {
	defer close(w.done)
	// Thirty seconds is deliberate. A condition worth an email is worth
	// half a minute of latency, and a tighter loop would send the first
	// message of a fleet-wide outage before the sweep has seen the rest of it.
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	cleanup := time.NewTicker(6 * time.Hour)
	defer cleanup.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick(ctx)
		case <-cleanup.C:
			if w.blocked() {
				continue
			}
			if err := w.svc.Cleanup(ctx); err != nil {
				w.logger.Error("notification retention failed", "error", err)
			}
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	if w.blocked() {
		return
	}
	for _, sweeper := range w.sweepers {
		if err := sweeper.Sweep(ctx); err != nil {
			// A sweeper that fails must not stop delivery of what is already
			// queued.
			w.logger.Error("condition sweep failed", "error", err)
		}
	}
	if _, err := w.svc.ScanIncidents(ctx); err != nil {
		w.logger.Error("scanning incidents for notification failed", "error", err)
	}
	if _, err := w.svc.DeliverDue(ctx); err != nil {
		w.logger.Error("sending notifications failed", "error", err)
	}
}

func (w *Worker) blocked() bool { return w.gate != nil && !w.gate() }
