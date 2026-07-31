-- +goose Up

CREATE TABLE brand_bug_instances (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 180),
    corner TEXT NOT NULL CHECK (corner IN ('top_left', 'top_right', 'bottom_left', 'bottom_right')),
    -- A deleted logo must not delete the mark. The instance survives with its
    -- text, and the Player simply stops receiving an image.
    image_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    text TEXT NOT NULL DEFAULT '' CHECK (char_length(text) <= 180),
    width_percent INTEGER NOT NULL CHECK (width_percent BETWEEN 2 AND 40),
    text_size_percent INTEGER NOT NULL CHECK (text_size_percent BETWEEN 1 AND 12),
    opacity_percent INTEGER NOT NULL CHECK (opacity_percent BETWEEN 10 AND 100),
    margin_percent INTEGER NOT NULL CHECK (margin_percent BETWEEN 0 AND 20),
    text_color TEXT NOT NULL CHECK (text_color ~ '^#[0-9a-fA-F]{6}$'),
    background_style TEXT NOT NULL CHECK (background_style IN ('none', 'scrim')),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -1000 AND 1000),
    target_scope TEXT NOT NULL CHECK (target_scope IN ('all', 'screens', 'sync_groups', 'locations')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE brand_bug_targets (
    instance_id UUID NOT NULL REFERENCES brand_bug_instances(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('screens', 'sync_groups', 'locations')),
    target_id UUID NOT NULL,
    PRIMARY KEY (instance_id, target_type, target_id)
);

CREATE INDEX brand_bug_instances_enabled_idx
    ON brand_bug_instances (enabled, corner, priority DESC, updated_at DESC);
CREATE INDEX brand_bug_instances_image_idx
    ON brand_bug_instances (image_asset_id);
CREATE INDEX brand_bug_targets_lookup_idx
    ON brand_bug_targets (target_type, target_id, instance_id);

-- +goose Down

DROP TABLE brand_bug_targets;
DROP TABLE brand_bug_instances;
