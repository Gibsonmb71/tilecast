-- +goose Up
ALTER TABLE upload_sessions
    ADD COLUMN final_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    ADD COLUMN final_variant_id UUID,
    ADD COLUMN final_storage_key TEXT,
    ADD COLUMN final_asset_type TEXT,
    ADD COLUMN final_detected_mime_type TEXT,
    ADD COLUMN final_sha256 BYTEA;

CREATE INDEX upload_sessions_finalizing_idx
    ON upload_sessions(status, created_at)
    WHERE status='finalizing';

-- +goose Down
DROP INDEX upload_sessions_finalizing_idx;
ALTER TABLE upload_sessions
    DROP COLUMN final_sha256,
    DROP COLUMN final_detected_mime_type,
    DROP COLUMN final_asset_type,
    DROP COLUMN final_storage_key,
    DROP COLUMN final_variant_id,
    DROP COLUMN final_asset_id;
