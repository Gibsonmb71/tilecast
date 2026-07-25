-- +goose Up
ALTER TABLE assets
    ADD COLUMN available_from TIMESTAMPTZ,
    ADD COLUMN expires_at TIMESTAMPTZ,
    ADD CONSTRAINT assets_availability_window_check
        CHECK (available_from IS NULL OR expires_at IS NULL OR available_from < expires_at);

CREATE INDEX assets_availability_idx
    ON assets(available_from, expires_at)
    WHERE deleted_at IS NULL AND origin = 'library';

ALTER TABLE playlists
    ADD COLUMN source_type TEXT NOT NULL DEFAULT 'static'
        CHECK (source_type IN ('static', 'tag')),
    ADD COLUMN tag_match TEXT NOT NULL DEFAULT 'any'
        CHECK (tag_match IN ('any', 'all')),
    ADD COLUMN tag_image_duration_ms BIGINT NOT NULL DEFAULT 10000
        CHECK (tag_image_duration_ms BETWEEN 1000 AND 86400000);

CREATE TABLE playlist_tags (
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES content_tags(id) ON DELETE RESTRICT,
    PRIMARY KEY (playlist_id, tag_id)
);
CREATE INDEX playlist_tags_tag_idx ON playlist_tags(tag_id, playlist_id);

-- +goose Down
DROP TABLE playlist_tags;
ALTER TABLE playlists
    DROP COLUMN tag_image_duration_ms,
    DROP COLUMN tag_match,
    DROP COLUMN source_type;
DROP INDEX assets_availability_idx;
ALTER TABLE assets
    DROP CONSTRAINT assets_availability_window_check,
    DROP COLUMN expires_at,
    DROP COLUMN available_from;
