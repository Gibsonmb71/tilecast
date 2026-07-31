-- +goose Up
ALTER TABLE assets ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX assets_archive_idx
    ON assets (organization_id, archived_at DESC, id DESC)
    WHERE deleted_at IS NULL AND archived_at IS NOT NULL AND origin = 'library' AND system_managed = FALSE;

CREATE INDEX assets_expiration_idx
    ON assets (expires_at, id)
    WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND origin = 'library' AND system_managed = FALSE;

-- +goose Down
DROP INDEX IF EXISTS assets_archive_idx;
DROP INDEX IF EXISTS assets_expiration_idx;
ALTER TABLE assets DROP COLUMN archived_at;
