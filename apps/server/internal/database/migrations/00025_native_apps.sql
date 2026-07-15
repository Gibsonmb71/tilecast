-- +goose Up
ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube','calendar','rss','atom','json','csv','clock','date','qrcode','ticker'));

-- +goose Down
DELETE FROM playlist_items
WHERE asset_id IN (SELECT asset_id FROM sources WHERE provider IN ('clock','date','qrcode','ticker'));
DELETE FROM assets
WHERE id IN (SELECT asset_id FROM sources WHERE provider IN ('clock','date','qrcode','ticker'));
ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube','calendar','rss','atom','json','csv'));
