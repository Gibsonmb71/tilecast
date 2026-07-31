-- +goose Up

-- 00077 installed the download-progress bound NOT VALID so that adding it did
-- not scan player_releases under ACCESS EXCLUSIVE. Validation belongs in its
-- own transaction: it takes only SHARE UPDATE EXCLUSIVE, so cache-progress and
-- release writes keep running while it reads.
--
-- Databases that applied 00077 before it was split already hold a validated
-- constraint; VALIDATE CONSTRAINT is a no-op there.
ALTER TABLE player_releases
    VALIDATE CONSTRAINT player_releases_cache_downloaded_bytes_check;

-- +goose Down

-- A constraint cannot be returned to NOT VALID, and 00077 drops it outright, so
-- there is nothing to undo here.
SELECT 1;
