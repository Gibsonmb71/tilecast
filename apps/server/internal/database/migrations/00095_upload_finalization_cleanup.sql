-- +goose Up

-- A failed finalization may have already published an object in storage. Keep
-- cleanup as a durable, retryable obligation instead of relying on the
-- request that discovered the failure to finish the delete.
ALTER TABLE upload_sessions
    ADD COLUMN finalization_cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX upload_sessions_finalization_cleanup_idx
    ON upload_sessions(status, created_at)
    WHERE status='failed' AND finalization_cleanup_pending=TRUE;

-- +goose Down
DROP INDEX upload_sessions_finalization_cleanup_idx;
ALTER TABLE upload_sessions
    DROP COLUMN finalization_cleanup_pending;
