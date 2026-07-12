-- +goose Up

CREATE TABLE player_releases (
    id uuid PRIMARY KEY,
    github_release_id bigint NOT NULL UNIQUE,
    github_tag text NOT NULL UNIQUE,
    channel text NOT NULL CHECK (channel IN ('stable','beta')),
    version_code bigint NOT NULL UNIQUE CHECK (version_code > 0),
    version_name text NOT NULL,
    application_id text NOT NULL CHECK (application_id = 'org.tilecast.player'),
    minimum_sdk integer NOT NULL CHECK (minimum_sdk >= 23),
    release_notes text NOT NULL DEFAULT '',
    published_at timestamptz NOT NULL,
    apk_name text NOT NULL CHECK (apk_name = 'tilecast-player.apk'),
    apk_size bigint NOT NULL CHECK (apk_size > 0),
    apk_sha256 text NOT NULL,
    signing_certificate_sha256 text NOT NULL,
    manifest jsonb NOT NULL,
    manifest_signature text NOT NULL,
    apk_download_url text NOT NULL,
    cache_status text NOT NULL DEFAULT 'missing' CHECK (cache_status IN ('missing','downloading','cached','failed')),
    verification_status text NOT NULL CHECK (verification_status IN ('verified_manifest','verified','failed')),
    verification_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE update_provider_state (
    provider text PRIMARY KEY,
    etag text,
    last_checked_at timestamptz,
    rate_limit_reset_at timestamptz,
    safe_error text,
    response jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE update_deployments (
    id uuid PRIMARY KEY,
    release_id uuid NOT NULL REFERENCES player_releases(id),
    name text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('download_only','install_now','maintenance_window')),
    maintenance_window_start timestamptz,
    created_by uuid REFERENCES users(id),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','cancelled','completed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    cancelled_at timestamptz,
    completed_at timestamptz
);

CREATE TABLE update_deployment_targets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    deployment_id uuid NOT NULL REFERENCES update_deployments(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN ('screen','group')),
    screen_id uuid REFERENCES screens(id),
    screen_group_id uuid REFERENCES screen_groups(id),
    CHECK ((target_type='screen' AND screen_id IS NOT NULL AND screen_group_id IS NULL) OR
           (target_type='group' AND screen_group_id IS NOT NULL AND screen_id IS NULL))
);
CREATE UNIQUE INDEX update_deployment_screen_target_unique ON update_deployment_targets(deployment_id,screen_id) WHERE screen_id IS NOT NULL;
CREATE UNIQUE INDEX update_deployment_group_target_unique ON update_deployment_targets(deployment_id,screen_group_id) WHERE screen_group_id IS NOT NULL;

CREATE TABLE screen_update_states (
    deployment_id uuid NOT NULL REFERENCES update_deployments(id) ON DELETE CASCADE,
    screen_id uuid NOT NULL REFERENCES screens(id),
    previous_version_code bigint,
    expected_version_code bigint NOT NULL,
    downloaded_bytes bigint NOT NULL DEFAULT 0,
    permission_status text,
    installer_status text,
    state text NOT NULL CHECK (state IN ('pending','offline','downloading','downloaded','verifying','ready','waiting_for_permission','waiting_for_user','installing','reconnecting','succeeded','failed','cancelled','incompatible','already_current')),
    safe_error text,
    download_started_at timestamptz,
    downloaded_at timestamptz,
    install_started_at timestamptz,
    reconnect_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (deployment_id,screen_id)
);
CREATE INDEX screen_update_states_screen_active ON screen_update_states(screen_id,state) WHERE state NOT IN ('succeeded','failed','cancelled','incompatible','already_current');

ALTER TABLE player_commands DROP CONSTRAINT player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN ('sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data','disable_playback','enable_playback','install_player_update'));

ALTER TABLE screen_player_status
    ADD COLUMN player_version_code bigint,
    ADD COLUMN android_sdk integer,
    ADD COLUMN installer_source text,
    ADD COLUMN install_permission_status text,
    ADD COLUMN current_update_deployment_id uuid REFERENCES update_deployments(id),
    ADD COLUMN update_state text,
    ADD COLUMN update_downloaded_bytes bigint,
    ADD COLUMN update_expected_bytes bigint,
    ADD COLUMN update_error text;

-- +goose Down

ALTER TABLE screen_player_status
    DROP COLUMN update_error,
    DROP COLUMN update_expected_bytes,
    DROP COLUMN update_downloaded_bytes,
    DROP COLUMN update_state,
    DROP COLUMN current_update_deployment_id,
    DROP COLUMN install_permission_status,
    DROP COLUMN installer_source,
    DROP COLUMN android_sdk,
    DROP COLUMN player_version_code;
ALTER TABLE player_commands DROP CONSTRAINT player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN ('sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data','disable_playback','enable_playback'));
DROP TABLE screen_update_states;
DROP TABLE update_deployment_targets;
DROP TABLE update_deployments;
DROP TABLE update_provider_state;
DROP TABLE player_releases;
