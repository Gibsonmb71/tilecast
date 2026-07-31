-- +goose Up

ALTER TABLE player_releases
    ADD COLUMN cache_downloaded_bytes bigint NOT NULL DEFAULT 0;

ALTER TABLE player_releases
    ADD CONSTRAINT player_releases_cache_downloaded_bytes_check
    CHECK (cache_downloaded_bytes >= 0 AND cache_downloaded_bytes <= apk_size);

-- +goose Down

ALTER TABLE player_releases
    DROP CONSTRAINT player_releases_cache_downloaded_bytes_check,
    DROP COLUMN cache_downloaded_bytes;
