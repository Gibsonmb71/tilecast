-- +goose Up

CREATE TABLE emergency_takeovers (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization_settings(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    playlist_id uuid NOT NULL REFERENCES playlists(id),
    status text NOT NULL CHECK (status IN ('draft','active','cancelling','cancelled','expired')),
    activated_by uuid REFERENCES users(id),
    activated_at timestamptz,
    expires_at timestamptz NOT NULL,
    cancelled_by uuid REFERENCES users(id),
    cancelled_at timestamptz,
    cancellation_reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE TABLE emergency_targets (
	 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emergency_id uuid NOT NULL REFERENCES emergency_takeovers(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN ('screen','group')),
    screen_id uuid REFERENCES screens(id),
    screen_group_id uuid REFERENCES screen_groups(id),
    CHECK ((target_type='screen' AND screen_id IS NOT NULL AND screen_group_id IS NULL) OR
           (target_type='group' AND screen_group_id IS NOT NULL AND screen_id IS NULL))
);
CREATE UNIQUE INDEX emergency_screen_target_unique ON emergency_targets(emergency_id,screen_id) WHERE screen_id IS NOT NULL;
CREATE UNIQUE INDEX emergency_group_target_unique ON emergency_targets(emergency_id,screen_group_id) WHERE screen_group_id IS NOT NULL;

CREATE TABLE emergency_screen_states (
    emergency_id uuid NOT NULL REFERENCES emergency_takeovers(id) ON DELETE CASCADE,
    screen_id uuid NOT NULL REFERENCES screens(id),
    manifest_version bigint NOT NULL,
    state text NOT NULL CHECK (state IN ('pending','notified','preparing','ready','active','failed','offline','restored','expired','cancelled')),
    last_updated_at timestamptz NOT NULL DEFAULT now(),
    failure_code text,
    safe_failure_message text,
    prepared_at timestamptz,
    activated_at timestamptz,
    restored_at timestamptz,
    PRIMARY KEY (emergency_id, screen_id)
);

CREATE TABLE player_commands (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization_settings(id),
    screen_id uuid NOT NULL REFERENCES screens(id),
    type text NOT NULL CHECK (type IN ('sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data','disable_playback','enable_playback')),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key uuid NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','acknowledged','running','succeeded','failed','expired','cancelled')),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    delivered_at timestamptz,
    acknowledged_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    safe_result_code text,
    safe_result_message text,
    attempt_count integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (screen_id, idempotency_key),
    CHECK (expires_at > created_at)
);
CREATE INDEX player_commands_pending_screen ON player_commands(screen_id,created_at) WHERE state IN ('pending','delivered','acknowledged','running');
CREATE INDEX player_commands_retention ON player_commands(completed_at) WHERE completed_at IS NOT NULL;

ALTER TABLE screen_player_status
    ADD COLUMN active_emergency_id uuid REFERENCES emergency_takeovers(id),
    ADD COLUMN emergency_state text,
    ADD COLUMN emergency_preparation_progress integer,
    ADD COLUMN playback_disabled boolean NOT NULL DEFAULT false,
    ADD COLUMN last_command_id uuid REFERENCES player_commands(id),
    ADD COLUMN last_command_state text,
    ADD COLUMN last_command_result text,
    ADD COLUMN last_command_completed_at timestamptz;

-- Migrate the Milestone 6 clear-data queue into the general command model.
INSERT INTO player_commands(id,organization_id,screen_id,type,idempotency_key,state,created_by,created_at,expires_at,completed_at,safe_result_code)
SELECT w.id,s.organization_id,w.screen_id,'clear_website_data',w.id,
       CASE w.status WHEN 'completed' THEN 'succeeded' WHEN 'failed' THEN 'failed' WHEN 'expired' THEN 'expired' ELSE 'pending' END,
       w.requested_by,w.created_at,w.expires_at,w.completed_at,w.error_category
FROM website_data_clear_commands w JOIN screens s ON s.id=w.screen_id;

DROP TABLE website_data_clear_commands;

-- +goose Down

CREATE TABLE website_data_clear_commands (
    id uuid PRIMARY KEY,
    screen_id uuid NOT NULL REFERENCES screens(id),
    requested_by uuid REFERENCES users(id),
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    error_category text
);
ALTER TABLE screen_player_status
    DROP COLUMN last_command_completed_at,
    DROP COLUMN last_command_result,
    DROP COLUMN last_command_state,
    DROP COLUMN last_command_id,
    DROP COLUMN playback_disabled,
    DROP COLUMN emergency_preparation_progress,
    DROP COLUMN emergency_state,
    DROP COLUMN active_emergency_id;
DROP TABLE player_commands;
DROP TABLE emergency_screen_states;
DROP TABLE emergency_targets;
DROP TABLE emergency_takeovers;
