-- +goose Up

CREATE TABLE organization_runtime_settings (
    organization_id uuid PRIMARY KEY REFERENCES organization_settings(id) ON DELETE CASCADE,
    schema_version integer NOT NULL DEFAULT 1,
    revision bigint NOT NULL DEFAULT 1,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by uuid REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    schema_version integer NOT NULL DEFAULT 1,
    revision bigint NOT NULL DEFAULT 1,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE screen_group_player_policies (
    screen_group_id uuid PRIMARY KEY REFERENCES screen_groups(id) ON DELETE CASCADE,
    priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN -1000 AND 1000),
    schema_version integer NOT NULL DEFAULT 1,
    revision bigint NOT NULL DEFAULT 1,
    policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by uuid REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE screen_player_policies (
    screen_id uuid PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    schema_version integer NOT NULL DEFAULT 1,
    revision bigint NOT NULL DEFAULT 1,
    policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by uuid REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE screen_config_state (
    screen_id uuid PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    config_revision bigint NOT NULL DEFAULT 1,
    changed_at timestamptz NOT NULL DEFAULT now(),
    change_reason text NOT NULL DEFAULT 'initial',
    active_config_revision bigint,
    config_error text,
    last_requested_at timestamptz
);
INSERT INTO screen_config_state(screen_id) SELECT id FROM screens ON CONFLICT DO NOTHING;

ALTER TABLE screen_player_status ADD COLUMN active_config_revision bigint, ADD COLUMN configuration_error text;

CREATE INDEX user_preferences_updated_idx ON user_preferences(updated_at);
CREATE INDEX group_policy_priority_idx ON screen_group_player_policies(priority DESC,screen_group_id);

-- +goose Down

ALTER TABLE screen_player_status DROP COLUMN configuration_error, DROP COLUMN active_config_revision;
DROP TABLE screen_config_state;
DROP TABLE screen_player_policies;
DROP TABLE screen_group_player_policies;
DROP TABLE user_preferences;
DROP TABLE organization_runtime_settings;
