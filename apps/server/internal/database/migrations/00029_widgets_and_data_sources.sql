-- +goose Up
-- Split the unified "source" content model into two independent domain records:
--   * Widgets       -- renderable visual content (kept as assets of type 'widget')
--   * Data Sources  -- reusable non-visual data connections (new top-level table)
-- This is an intentional pre-v1 breaking change. Existing development Apps/Sources and
-- Layouts are NOT migrated; disposable development rows are removed for a clean schema.

-- 1. Retire content that depends on the old unified model.
--    Data-provider and data-driven rows cannot be expressed in the new schema, and every
--    layout document uses the retired app/appId placement shape, so both are cleared.
DELETE FROM playlist_items
    WHERE asset_id IN (
        SELECT asset_id FROM sources
        WHERE provider IN ('calendar','rss','atom','json','csv','ticker','menu','list','table','agenda')
    );
DELETE FROM layouts;  -- cascades to layout_revisions and dependency tables

-- 2. Data Sources: new first-class table plus its refresh/cache state.
CREATE TABLE data_sources (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL CHECK (provider IN ('calendar','rss','atom','json','csv')),
    config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version > 0),
    configuration JSONB NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX data_sources_library_idx ON data_sources(provider, updated_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE data_source_refresh_states (
    data_source_id UUID PRIMARY KEY REFERENCES data_sources(id) ON DELETE CASCADE,
    next_refresh_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    http_result_category TEXT,
    parse_status TEXT NOT NULL DEFAULT 'not_attempted',
    available_event_count INTEGER NOT NULL DEFAULT 0 CHECK (available_event_count >= 0),
    available_item_count INTEGER NOT NULL DEFAULT 0 CHECK (available_item_count >= 0),
    using_cached_data BOOLEAN NOT NULL DEFAULT FALSE,
    cache_updated_at TIMESTAMPTZ,
    cache_expires_at TIMESTAMPTZ,
    cached_payload JSONB NOT NULL DEFAULT '{"events":[]}'::jsonb CHECK (jsonb_typeof(cached_payload) = 'object'),
    error_code TEXT,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX data_source_refresh_states_claim_idx
    ON data_source_refresh_states(next_refresh_at, data_source_id)
    WHERE locked_at IS NULL;

-- 3. Widgets: rename sources -> widgets and restrict to renderable providers.
DROP TABLE source_refresh_states;
DELETE FROM assets
    WHERE id IN (
        SELECT asset_id FROM sources
        WHERE provider IN ('calendar','rss','atom','json','csv','ticker','menu','list','table','agenda')
    );  -- source rows cascade via assets FK
ALTER TABLE sources RENAME TO widgets;
ALTER INDEX sources_provider_idx RENAME TO widgets_provider_idx;
ALTER TABLE widgets DROP CONSTRAINT sources_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN ('website','youtube','clock','date','qrcode','ticker','menu','list','table','agenda'));

-- 4. Reclassify the asset type discriminator: 'source' -> 'widget'.
ALTER TABLE assets DROP CONSTRAINT assets_type_check;
UPDATE assets SET type='widget' WHERE type='source';
ALTER TABLE assets ADD CONSTRAINT assets_type_check CHECK (type IN ('image','video','widget'));

-- 5. Screen runtime status: source_* columns describe the active Widget now.
ALTER TABLE screen_player_status RENAME COLUMN current_source_id TO current_widget_id;
ALTER TABLE screen_player_status RENAME COLUMN source_provider TO widget_provider;
ALTER TABLE screen_player_status RENAME COLUMN source_state TO widget_state;
ALTER TABLE screen_player_status RENAME COLUMN source_error TO widget_error;

-- 6. Layout dependency taxonomy: 'app' -> 'widget', add 'data_source' for text bindings.
ALTER TABLE layout_draft_dependencies DROP CONSTRAINT layout_draft_dependencies_dependency_type_check;
ALTER TABLE layout_draft_dependencies ADD CONSTRAINT layout_draft_dependencies_dependency_type_check
    CHECK (dependency_type IN ('widget','asset','playlist','data_source'));
ALTER TABLE layout_revision_dependencies DROP CONSTRAINT layout_revision_dependencies_dependency_type_check;
ALTER TABLE layout_revision_dependencies ADD CONSTRAINT layout_revision_dependencies_dependency_type_check
    CHECK (dependency_type IN ('widget','asset','playlist','data_source'));

-- +goose Down
-- Structural reverse only; wiped development content is not restored.
ALTER TABLE layout_revision_dependencies DROP CONSTRAINT layout_revision_dependencies_dependency_type_check;
ALTER TABLE layout_revision_dependencies ADD CONSTRAINT layout_revision_dependencies_dependency_type_check
    CHECK (dependency_type IN ('app','asset','playlist'));
ALTER TABLE layout_draft_dependencies DROP CONSTRAINT layout_draft_dependencies_dependency_type_check;
ALTER TABLE layout_draft_dependencies ADD CONSTRAINT layout_draft_dependencies_dependency_type_check
    CHECK (dependency_type IN ('app','asset','playlist'));

ALTER TABLE screen_player_status RENAME COLUMN widget_error TO source_error;
ALTER TABLE screen_player_status RENAME COLUMN widget_state TO source_state;
ALTER TABLE screen_player_status RENAME COLUMN widget_provider TO source_provider;
ALTER TABLE screen_player_status RENAME COLUMN current_widget_id TO current_source_id;

ALTER TABLE assets DROP CONSTRAINT assets_type_check;
UPDATE assets SET type='source' WHERE type='widget';
ALTER TABLE assets ADD CONSTRAINT assets_type_check CHECK (type IN ('image','video','source'));

ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN ('website','youtube','calendar','rss','atom','json','csv','clock','date','qrcode','ticker','menu','list','table','agenda'));
ALTER INDEX widgets_provider_idx RENAME TO sources_provider_idx;
ALTER TABLE widgets RENAME TO sources;

CREATE TABLE source_refresh_states (
    asset_id UUID PRIMARY KEY REFERENCES sources(asset_id) ON DELETE CASCADE,
    next_refresh_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    http_result_category TEXT,
    parse_status TEXT NOT NULL DEFAULT 'not_attempted',
    available_event_count INTEGER NOT NULL DEFAULT 0 CHECK (available_event_count >= 0),
    available_item_count INTEGER NOT NULL DEFAULT 0 CHECK (available_item_count >= 0),
    using_cached_data BOOLEAN NOT NULL DEFAULT FALSE,
    cache_updated_at TIMESTAMPTZ,
    cache_expires_at TIMESTAMPTZ,
    cached_payload JSONB NOT NULL DEFAULT '{"events":[]}'::jsonb CHECK (jsonb_typeof(cached_payload) = 'object'),
    error_code TEXT,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX source_refresh_states_claim_idx
    ON source_refresh_states(next_refresh_at, asset_id)
    WHERE locked_at IS NULL;

DROP TABLE data_source_refresh_states;
DROP TABLE data_sources;
