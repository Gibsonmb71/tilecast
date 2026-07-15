-- +goose Up
ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube','calendar','rss','atom','json','csv','clock','date','qrcode','ticker','menu','list','table','agenda'));

-- +goose Down
DELETE FROM source_refresh_states
WHERE asset_id IN (SELECT asset_id FROM sources WHERE provider IN ('menu','list','table','agenda'));
DELETE FROM assets
WHERE id IN (SELECT asset_id FROM sources WHERE provider IN ('menu','list','table','agenda'));
ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube','calendar','rss','atom','json','csv','clock','date','qrcode','ticker'));
