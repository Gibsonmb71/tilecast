package snapshots

import (
	"context"
	"log/slog"
	"time"
)

// Worker requests scheduled captures and applies retention.
type Worker struct {
	svc    *Service
	logger *slog.Logger
	gate   func() bool

	cancel context.CancelFunc
	done   chan struct{}
}

// NewWorker creates the snapshot worker.
func NewWorker(svc *Service, logger *slog.Logger) *Worker {
	return &Worker{svc: svc, logger: logger}
}

// SetGate installs the backup guard so a restore is not interrupted.
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
	// The tick is much shorter than the capture interval because the interval
	// is enforced per screen by the query, not by the tick. A five-minute tick
	// keeps a fifteen-minute interval roughly honest without a timer per screen.
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if w.gate != nil && !w.gate() {
				continue
			}
			if err := w.svc.Sweep(ctx); err != nil {
				w.logger.Error("snapshot sweep failed", "error", err)
			}
		}
	}
}
