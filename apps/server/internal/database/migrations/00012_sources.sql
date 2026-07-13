-- +goose Up
CREATE TABLE sources (
    asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('website','youtube')),
    config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
    configuration JSONB NOT NULL CHECK(jsonb_typeof(configuration) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sources_provider_idx ON sources(provider, updated_at DESC, asset_id);

INSERT INTO sources(asset_id,provider,config_version,configuration,created_at,updated_at)
SELECT
    asset_id,
    'website',
    1,
    jsonb_build_object(
        'url', url,
        'displayUrl', display_url,
        'allowedHosts', to_jsonb(allowed_hosts),
        'javascriptEnabled', javascript_enabled,
        'domStorageEnabled', dom_storage_enabled,
        'cookiePolicy', cookie_policy,
        'reloadPolicy', reload_policy,
        'refreshIntervalSeconds', refresh_interval_seconds,
        'loadTimeoutSeconds', load_timeout_seconds,
        'zoomPercent', zoom_percent,
        'scrollX', scroll_x,
        'scrollY', scroll_y,
        'customUserAgent', custom_user_agent,
        'backgroundColor', background_color,
        'failureBehavior', failure_behavior,
        'fallbackImageAssetId', fallback_image_asset_id
    ),
    created_at,
    updated_at
FROM website_assets;

ALTER TABLE assets DROP CONSTRAINT assets_type_check;
UPDATE assets SET type='source' WHERE type='website';
ALTER TABLE assets ADD CONSTRAINT assets_type_check CHECK(type IN ('image','video','source'));

ALTER TABLE screen_player_status
    ADD COLUMN current_source_id UUID,
    ADD COLUMN source_provider TEXT,
    ADD COLUMN source_state TEXT,
    ADD COLUMN source_error TEXT;

-- +goose Down
ALTER TABLE screen_player_status
    DROP COLUMN source_error,
    DROP COLUMN source_state,
    DROP COLUMN source_provider,
    DROP COLUMN current_source_id;
ALTER TABLE assets DROP CONSTRAINT assets_type_check;
UPDATE assets SET type='website' WHERE type='source' AND id IN (SELECT asset_id FROM sources WHERE provider='website');
ALTER TABLE assets ADD CONSTRAINT assets_type_check CHECK(type IN ('image','video','website','source'));
DROP TABLE sources;
