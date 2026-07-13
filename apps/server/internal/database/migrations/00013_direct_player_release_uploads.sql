-- +goose Up

ALTER TABLE player_releases
    ALTER COLUMN github_release_id DROP NOT NULL,
    ALTER COLUMN github_tag DROP NOT NULL,
    ALTER COLUMN apk_download_url DROP NOT NULL,
    ADD COLUMN source text NOT NULL DEFAULT 'github' CHECK (source IN ('github','upload')),
    ADD COLUMN imported_by uuid REFERENCES users(id);

-- +goose Down

ALTER TABLE player_releases
    DROP COLUMN imported_by,
    DROP COLUMN source;

DELETE FROM player_releases WHERE github_release_id IS NULL OR github_tag IS NULL OR apk_download_url IS NULL;

ALTER TABLE player_releases
    ALTER COLUMN github_release_id SET NOT NULL,
    ALTER COLUMN github_tag SET NOT NULL,
    ALTER COLUMN apk_download_url SET NOT NULL;
