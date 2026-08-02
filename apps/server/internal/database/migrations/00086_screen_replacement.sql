-- +goose Up

-- A pairing repair keeps the same physical player installation and only
-- rotates its credential. Hardware replacement is an explicit approval mode:
-- it assigns a newly paired player to an existing logical screen and records
-- the hardware transition without touching the screen's content or policy
-- relationships.
ALTER TABLE device_pairing_sessions
    ADD COLUMN pairing_mode TEXT NOT NULL DEFAULT 'new_screen'
        CHECK (pairing_mode IN ('new_screen', 'credential_repair', 'hardware_replacement')),
    ADD COLUMN replacement_screen_id UUID REFERENCES screens(id) ON DELETE SET NULL;

CREATE TABLE screen_player_history (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    credential_id UUID REFERENCES device_credentials(id) ON DELETE SET NULL,
    installation_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    android_version TEXT NOT NULL,
    player_version TEXT NOT NULL,
    screen_width INTEGER NOT NULL CHECK (screen_width > 0),
    screen_height INTEGER NOT NULL CHECK (screen_height > 0),
    density REAL NOT NULL CHECK (density > 0),
    locale TEXT NOT NULL,
    timezone TEXT NOT NULL,
    paired_at TIMESTAMPTZ NOT NULL,
    retired_at TIMESTAMPTZ,
    retirement_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (retired_at IS NULL OR retired_at >= paired_at)
);

CREATE INDEX screen_player_history_screen_idx
    ON screen_player_history(screen_id, paired_at DESC, id DESC);
CREATE UNIQUE INDEX screen_player_history_current_unique
    ON screen_player_history(screen_id)
    WHERE retired_at IS NULL;

-- Existing installations have no historical pairing rows. Seed one current
-- row per screen so the new Studio view is useful immediately; archived
-- screens are represented as retired hardware.
INSERT INTO screen_player_history (
    id, screen_id, credential_id, installation_id, platform, manufacturer,
    model, android_version, player_version, screen_width, screen_height,
    density, locale, timezone, paired_at, retired_at, retirement_reason
)
SELECT
    gen_random_uuid(), s.id,
    (SELECT c.id FROM device_credentials c
     WHERE c.screen_id = s.id
     ORDER BY c.created_at DESC, c.id DESC LIMIT 1),
    s.player_installation_id, s.platform, s.device_manufacturer,
    s.device_model, s.android_version, s.player_version, s.screen_width,
    s.screen_height, s.density, s.locale, s.timezone, s.paired_at,
    CASE WHEN s.archived_at IS NOT NULL THEN s.archived_at END,
    CASE WHEN s.archived_at IS NOT NULL THEN COALESCE(NULLIF(s.archived_reason, ''), 'Screen archived') ELSE '' END
FROM screens s;

-- +goose Down

DROP TABLE screen_player_history;
ALTER TABLE device_pairing_sessions
    DROP COLUMN replacement_screen_id,
    DROP COLUMN pairing_mode;
