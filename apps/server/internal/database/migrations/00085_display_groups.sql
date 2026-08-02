-- +goose Up

-- `screen_groups` remains the internal table name for compatibility with the
-- existing schedule, assignment, scope, and AirPlay code.  Existing groups
-- are explicitly Mirror groups so this migration does not change playback.
ALTER TABLE screen_groups
    ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'mirror'
    CHECK (display_mode IN ('mirror', 'span'));

-- +goose Down

ALTER TABLE screen_groups
    DROP COLUMN display_mode;
