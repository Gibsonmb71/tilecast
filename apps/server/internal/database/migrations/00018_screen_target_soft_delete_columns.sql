-- +goose Up

-- Player update deployment queries exclude soft-deleted targets, but the original
-- screen and screen-group migrations did not create the columns those queries use.
ALTER TABLE screens
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE screen_groups
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS screens_active_id_idx
    ON screens(id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS screen_groups_active_id_idx
    ON screen_groups(id)
    WHERE deleted_at IS NULL;

-- +goose Down

DROP INDEX IF EXISTS screen_groups_active_id_idx;
DROP INDEX IF EXISTS screens_active_id_idx;

ALTER TABLE screen_groups
    DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE screens
    DROP COLUMN IF EXISTS deleted_at;
