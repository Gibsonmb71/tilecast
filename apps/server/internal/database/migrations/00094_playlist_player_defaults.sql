-- +goose Up
-- Existing playback columns remain the authored fallback for old clients. This
-- flag lets a playlist item explicitly delegate those decisions to the
-- authoritative Player policy document.
ALTER TABLE playlist_items
    ADD COLUMN use_player_defaults BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE playlist_items
    DROP COLUMN use_player_defaults;
