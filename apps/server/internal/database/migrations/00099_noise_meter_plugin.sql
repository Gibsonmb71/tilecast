-- +goose Up

CREATE TABLE noise_meter_instances (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 180),
    -- Optional. An empty message leaves the Player's own "TOO LOUD" label,
    -- which is what the bar says when nobody has written anything better.
    message TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 120),
    -- Levels are the normalized 0-100 Tilecast scale, never dB, dBA, or SPL: a
    -- generic USB microphone has no calibrated sensitivity to express one.
    warning_level INTEGER NOT NULL CHECK (warning_level BETWEEN 1 AND 99),
    loud_level INTEGER NOT NULL CHECK (loud_level BETWEEN 2 AND 100),
    sensitivity INTEGER NOT NULL CHECK (sensitivity BETWEEN 25 AND 300),
    trigger_hold_ms INTEGER NOT NULL CHECK (trigger_hold_ms BETWEEN 100 AND 10000),
    clear_hold_ms INTEGER NOT NULL CHECK (clear_hold_ms BETWEEN 500 AND 30000),
    display_mode TEXT NOT NULL CHECK (display_mode IN ('overlay', 'push')),
    height_px INTEGER NOT NULL CHECK (height_px BETWEEN 40 AND 320),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    target_scope TEXT NOT NULL CHECK (target_scope IN ('all', 'screens', 'sync_groups', 'locations')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Showing and hiding must never share one threshold, or the bar flaps.
    CHECK (warning_level < loud_level)
);

CREATE TABLE noise_meter_targets (
    instance_id UUID NOT NULL REFERENCES noise_meter_instances(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('screens', 'sync_groups', 'locations')),
    target_id UUID NOT NULL,
    PRIMARY KEY (instance_id, target_type, target_id)
);

CREATE INDEX noise_meter_instances_enabled_idx
    ON noise_meter_instances (enabled, id);
CREATE INDEX noise_meter_targets_lookup_idx
    ON noise_meter_targets (target_type, target_id, instance_id);

-- +goose Down

DROP TABLE noise_meter_targets;
DROP TABLE noise_meter_instances;
