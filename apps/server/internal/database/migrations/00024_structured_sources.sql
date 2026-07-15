-- +goose Up
ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube','calendar','rss','atom','json','csv'));

ALTER TABLE source_refresh_states
    ADD COLUMN available_item_count INTEGER NOT NULL DEFAULT 0 CHECK(available_item_count >= 0);

-- +goose Down
DELETE FROM playlist_items
WHERE asset_id IN (SELECT asset_id FROM sources WHERE provider IN ('rss','atom','json','csv'));
DELETE FROM assets
WHERE id IN (SELECT asset_id FROM sources WHERE provider IN ('rss','atom','json','csv'));
ALTER TABLE source_refresh_states DROP COLUMN available_item_count;
ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube','calendar'));
