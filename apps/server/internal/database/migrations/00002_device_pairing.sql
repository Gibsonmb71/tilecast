-- +goose Up
ALTER TABLE organization_settings
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN installation_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    ADD COLUMN pairing_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX organization_settings_id_unique ON organization_settings(id);
CREATE UNIQUE INDEX organization_settings_installation_id_unique ON organization_settings(installation_id);

CREATE TABLE screens (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    player_installation_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL,
    device_manufacturer TEXT NOT NULL,
    device_model TEXT NOT NULL,
    android_version TEXT NOT NULL,
    player_version TEXT NOT NULL,
    screen_width INTEGER NOT NULL CHECK (screen_width > 0),
    screen_height INTEGER NOT NULL CHECK (screen_height > 0),
    density REAL NOT NULL CHECK (density > 0),
    locale TEXT NOT NULL,
    timezone TEXT NOT NULL,
    available_storage_bytes BIGINT,
    uptime_seconds BIGINT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_connected_at TIMESTAMPTZ,
    last_disconnected_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    last_known_ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, player_installation_id)
);

CREATE INDEX screens_last_heartbeat_idx ON screens(last_heartbeat_at DESC);
CREATE INDEX screens_updated_at_idx ON screens(updated_at DESC);

CREATE TABLE device_credentials (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    public_id TEXT NOT NULL UNIQUE,
    secret_hash BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT
);

CREATE INDEX device_credentials_screen_id_idx ON device_credentials(screen_id);

CREATE TABLE device_pairing_sessions (
    id UUID PRIMARY KEY,
    code_hash BYTEA NOT NULL UNIQUE,
    poll_secret_hash BYTEA NOT NULL,
    enrollment_token_hash BYTEA,
    requested_metadata JSONB NOT NULL,
    requested_server_installation_id TEXT NOT NULL,
    player_installation_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','claimed','rejected','expired','cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    claimed_at TIMESTAMPTZ,
    enrolled_at TIMESTAMPTZ,
    resulting_screen_id UUID REFERENCES screens(id) ON DELETE SET NULL,
    failure_reason TEXT
);

CREATE INDEX device_pairing_sessions_expires_at_idx ON device_pairing_sessions(expires_at);
CREATE INDEX device_pairing_sessions_status_idx ON device_pairing_sessions(status);

-- +goose Down
DROP TABLE device_pairing_sessions;
DROP TABLE device_credentials;
DROP TABLE screens;
DROP INDEX organization_settings_installation_id_unique;
DROP INDEX organization_settings_id_unique;
ALTER TABLE organization_settings
    DROP COLUMN pairing_enabled,
    DROP COLUMN installation_id,
    DROP COLUMN id;

