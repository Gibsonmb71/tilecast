-- +goose Up

ALTER TABLE player_releases
    ADD COLUMN cache_downloaded_bytes bigint NOT NULL DEFAULT 0;

-- Installed NOT VALID so this migration never scans the table while it holds
-- ACCESS EXCLUSIVE; 00082 validates it in its own transaction. Every row the
-- column already has is 0 from the default above, so validation has nothing to
-- reject.
ALTER TABLE player_releases
    ADD CONSTRAINT player_releases_cache_downloaded_bytes_check
    CHECK (cache_downloaded_bytes >= 0 AND cache_downloaded_bytes <= apk_size)
    NOT VALID;

-- +goose Down

ALTER TABLE player_releases
    DROP CONSTRAINT player_releases_cache_downloaded_bytes_check,
    DROP COLUMN cache_downloaded_bytes;
