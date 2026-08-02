-- +goose Up

-- Group preparation used to be bounded by a 45-second context timeout inside a
-- goroutine. A server restart both lost the deadline and lost the only thing
-- that could advance or fail the session, so an interrupted group could sit in
-- 'preparing' until it expired. The deadline is now durable, and reconciliation
-- reads it from the database instead of from process-local elapsed time.
--
-- Nullable on purpose: sessions created before this migration, and every
-- single-screen session (which never waits for group preparation), have no
-- stored deadline. Reconciliation falls back to created_at + the same window,
-- so an interrupted pre-migration group still fails instead of stranding.
ALTER TABLE external_presentation_sessions
    ADD COLUMN prepare_deadline_at TIMESTAMPTZ;

-- +goose Down

ALTER TABLE external_presentation_sessions
    DROP COLUMN prepare_deadline_at;
