-- +goose Up
ALTER TABLE assets DROP CONSTRAINT assets_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_type_check CHECK(type IN ('image','video','website'));

CREATE TABLE website_assets (
    asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    display_url TEXT NOT NULL,
    allowed_hosts TEXT[] NOT NULL,
    javascript_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    dom_storage_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    cookie_policy TEXT NOT NULL DEFAULT 'first_party' CHECK(cookie_policy IN ('disabled','first_party','first_and_third_party')),
    reload_policy TEXT NOT NULL DEFAULT 'on_each_activation' CHECK(reload_policy IN ('load_once','on_each_activation','interval')),
    refresh_interval_seconds INTEGER,
    load_timeout_seconds INTEGER NOT NULL DEFAULT 20,
    zoom_percent INTEGER NOT NULL DEFAULT 100,
    scroll_x INTEGER NOT NULL DEFAULT 0,
    scroll_y INTEGER NOT NULL DEFAULT 0,
    custom_user_agent TEXT NOT NULL DEFAULT '',
    background_color TEXT NOT NULL DEFAULT '#13231E',
    failure_behavior TEXT NOT NULL DEFAULT 'placeholder' CHECK(failure_behavior IN ('last_success','placeholder','fallback_image','skip')),
    fallback_image_asset_id UUID REFERENCES assets(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK(cardinality(allowed_hosts)>0)
);

ALTER TABLE screen_player_status
    ADD COLUMN current_website_asset_id UUID,
    ADD COLUMN last_website_asset_id UUID,
    ADD COLUMN website_state TEXT,
    ADD COLUMN website_load_started_at TIMESTAMPTZ,
    ADD COLUMN website_load_completed_at TIMESTAMPTZ,
    ADD COLUMN website_failure_category TEXT,
    ADD COLUMN website_failure_at TIMESTAMPTZ,
    ADD COLUMN website_blocked_navigation_count INTEGER,
    ADD COLUMN website_current_host TEXT,
    ADD COLUMN website_fallback_shown BOOLEAN,
    ADD COLUMN website_renderer_recovery_count INTEGER;

CREATE TABLE website_data_clear_commands (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    error_category TEXT,
    UNIQUE(screen_id,id)
);
CREATE INDEX website_clear_pending_idx ON website_data_clear_commands(screen_id,expires_at) WHERE status='pending';
CREATE UNIQUE INDEX website_clear_one_pending_idx ON website_data_clear_commands(screen_id) WHERE status='pending';

-- +goose Down
DROP TABLE website_data_clear_commands;
ALTER TABLE screen_player_status
    DROP COLUMN website_renderer_recovery_count,
    DROP COLUMN website_fallback_shown,
    DROP COLUMN website_current_host,
    DROP COLUMN website_blocked_navigation_count,
    DROP COLUMN website_failure_category,
    DROP COLUMN website_failure_at,
    DROP COLUMN website_load_completed_at,
    DROP COLUMN website_load_started_at,
    DROP COLUMN website_state,
    DROP COLUMN last_website_asset_id,
    DROP COLUMN current_website_asset_id;
DROP TABLE website_assets;
ALTER TABLE assets DROP CONSTRAINT assets_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_type_check CHECK(type IN ('image','video'));
