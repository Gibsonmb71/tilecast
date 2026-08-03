-- +goose Up

-- Presentation Networks.
--
-- Many districts separate wired signage from Wi-Fi clients onto different
-- VLANs, so an Ethernet-only Linux player is not discoverable over Bonjour by
-- the iPad in the room. A Presentation Network is a reusable organization-level
-- Wi-Fi definition that an assigned Linux player joins *temporarily* on its
-- Wi-Fi adapter while AirPlay Present is running, while Ethernet remains the
-- default route and keeps carrying every Tilecast path: commands, WebSocket,
-- heartbeats, downloads, and group AirPlay RTP fan-out.
--
-- Tilecast does not route or bridge the two networks. There is no mDNS
-- reflector, no IP forwarding, and no hotspot mode. The gateway simply has a
-- second, non-default interface on the sender's network.
--
-- Credentials are the reason this table looks the way it does. The PSK or
-- Enterprise password is never stored in cleartext: it is sealed with
-- AES-256-GCM under TILECAST_PRESENTATION_NETWORK_KEY, bound by AAD to the
-- organization and network identifiers, and stored as an opaque versioned
-- envelope. Non-secret authentication metadata (identity, anonymous identity,
-- expected server domain, CA certificate) is ordinary JSON, because it is
-- public information a network administrator hands out.
CREATE TABLE presentation_networks (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    ssid TEXT NOT NULL CHECK (char_length(ssid) BETWEEN 1 AND 32),
    hidden BOOLEAN NOT NULL DEFAULT false,
    -- Only the two authentication types Tilecast has actually validated. The
    -- column is a check rather than an enum so a later, tested EAP method is a
    -- migration and not a schema type change; nothing pretends to support an
    -- untested method today.
    security TEXT NOT NULL CHECK (security IN ('wpa_psk', 'wpa_eap_peap_mschapv2')),
    auth_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(auth_metadata) = 'object'),
    -- The sealed credential. Nullable only for the window between creating a
    -- network and sealing its secret inside the same transaction; a network
    -- whose ciphertext is missing reports itself as needing the credential
    -- re-entered rather than silently provisioning nothing.
    secret_ciphertext BYTEA,
    secret_envelope_version INTEGER,
    secret_updated_at TIMESTAMPTZ,
    -- Bumped whenever the SSID, hidden flag, security type, non-secret
    -- authentication metadata, or the credential itself changes. The player
    -- compares this against the revision it has installed to decide whether a
    -- provisioned NetworkManager profile is stale.
    config_revision BIGINT NOT NULL DEFAULT 1 CHECK (config_revision > 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((secret_ciphertext IS NULL) = (secret_envelope_version IS NULL))
);
CREATE UNIQUE INDEX presentation_networks_name_unique
    ON presentation_networks(organization_id, lower(name));
CREATE INDEX presentation_networks_organization_idx
    ON presentation_networks(organization_id, lower(name));

-- Assignment is a separate row rather than a column on screens, so credentials
-- are never copied per screen and one network can serve a whole building. For
-- AirPlay v1 a screen has at most one active Presentation Network, which the
-- primary key enforces without a partial-unique trick.
CREATE TABLE screen_presentation_networks (
    screen_id UUID PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    presentation_network_id UUID NOT NULL REFERENCES presentation_networks(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX screen_presentation_networks_network_idx
    ON screen_presentation_networks(presentation_network_id);

-- Which network the gateway was asked to join for this session. Kept for the
-- Studio preparation copy ("Joining District Staff Wi-Fi…") and for the audit
-- trail; SET NULL rather than RESTRICT so deleting a network never wedges an
-- old session row.
ALTER TABLE external_presentation_sessions
    ADD COLUMN presentation_network_id UUID REFERENCES presentation_networks(id) ON DELETE SET NULL;

-- Presentation Network capability and state, reported by the Linux probe.
--
-- These are deliberately separate from the ordinary telemetry gauges. The
-- existing network_link_type keeps describing the interface that carries the
-- default route, so a temporary Wi-Fi sidecar never makes the fleet's
-- link-quality metrics describe the wrong path.
ALTER TABLE screen_player_status
    ADD COLUMN presentation_network_supported BOOLEAN,
    ADD COLUMN presentation_network_helper_state TEXT,
    ADD COLUMN presentation_network_manager_available BOOLEAN,
    ADD COLUMN presentation_network_wifi_adapter BOOLEAN,
    ADD COLUMN presentation_network_radio_enabled BOOLEAN,
    ADD COLUMN presentation_network_state TEXT,
    ADD COLUMN presentation_network_installed_id UUID,
    ADD COLUMN presentation_network_installed_revision BIGINT,
    ADD COLUMN presentation_network_active_id UUID,
    ADD COLUMN presentation_network_last_connected_at TIMESTAMPTZ,
    ADD COLUMN presentation_network_last_failure_at TIMESTAMPTZ,
    ADD COLUMN presentation_network_last_failure_code TEXT,
    ADD COLUMN presentation_network_limitation TEXT,
    -- The wired facts group AirPlay RTP fan-out needs. last_known_ip is
    -- whatever address the player's last request arrived from, which stops
    -- being an unambiguous answer the moment a player can hold two addresses.
    -- Everything else keeps using last_known_ip; only AirPlay transport moves.
    ADD COLUMN wired_interface_available BOOLEAN,
    ADD COLUMN wired_ipv4 INET;
ALTER TABLE screen_player_status ADD CONSTRAINT presentation_network_helper_state_check CHECK (
    presentation_network_helper_state IS NULL OR presentation_network_helper_state IN (
        'ok', 'missing', 'unhealthy', 'unsupported'
    )
);
ALTER TABLE screen_player_status ADD CONSTRAINT presentation_network_state_check CHECK (
    presentation_network_state IS NULL OR presentation_network_state IN (
        'unsupported', 'unassigned', 'pending', 'provisioned', 'joining', 'connected', 'failed'
    )
);
ALTER TABLE screen_player_status ADD CONSTRAINT wired_ipv4_family_check CHECK (
    wired_ipv4 IS NULL OR family(wired_ipv4) = 4
);

ALTER TABLE player_commands DROP CONSTRAINT IF EXISTS player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test',
    'install_autostart','remove_autostart',
    'prepare_airplay_session','stop_airplay_session','test_airplay_support',
    'display_power_on','display_power_off','display_set_input','display_set_volume',
    'display_mute','display_unmute','display_set_brightness','display_probe',
    'provision_presentation_network','test_presentation_network'
));

-- +goose Down

ALTER TABLE player_commands DROP CONSTRAINT IF EXISTS player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test',
    'install_autostart','remove_autostart',
    'prepare_airplay_session','stop_airplay_session','test_airplay_support',
    'display_power_on','display_power_off','display_set_input','display_set_volume',
    'display_mute','display_unmute','display_set_brightness','display_probe'
));

ALTER TABLE screen_player_status
    DROP CONSTRAINT wired_ipv4_family_check,
    DROP CONSTRAINT presentation_network_state_check,
    DROP CONSTRAINT presentation_network_helper_state_check,
    DROP COLUMN wired_ipv4,
    DROP COLUMN wired_interface_available,
    DROP COLUMN presentation_network_limitation,
    DROP COLUMN presentation_network_last_failure_code,
    DROP COLUMN presentation_network_last_failure_at,
    DROP COLUMN presentation_network_last_connected_at,
    DROP COLUMN presentation_network_active_id,
    DROP COLUMN presentation_network_installed_revision,
    DROP COLUMN presentation_network_installed_id,
    DROP COLUMN presentation_network_state,
    DROP COLUMN presentation_network_radio_enabled,
    DROP COLUMN presentation_network_wifi_adapter,
    DROP COLUMN presentation_network_manager_available,
    DROP COLUMN presentation_network_helper_state,
    DROP COLUMN presentation_network_supported;

ALTER TABLE external_presentation_sessions
    DROP COLUMN presentation_network_id;

DROP TABLE screen_presentation_networks;
DROP TABLE presentation_networks;
