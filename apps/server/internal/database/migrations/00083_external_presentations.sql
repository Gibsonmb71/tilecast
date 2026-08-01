-- +goose Up

-- AirPlay is an external presentation owned by the player, not a playlist
-- item. The session rows are intentionally short lived and contain no frame
-- data. PIN/device identity are cleared when a session reaches a terminal
-- state; they exist only long enough to deliver the session to the player.
ALTER TABLE screen_groups
    ADD COLUMN presentation_gateway_screen_id UUID REFERENCES screens(id) ON DELETE SET NULL;

ALTER TABLE player_commands DROP CONSTRAINT IF EXISTS player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test',
    'install_autostart','remove_autostart',
    'prepare_airplay_session','stop_airplay_session','test_airplay_support'
));

ALTER TABLE screen_player_status
    ADD COLUMN airplay_supported BOOLEAN,
    ADD COLUMN airplay_uxplay_installed BOOLEAN,
    ADD COLUMN airplay_uxplay_version TEXT,
    ADD COLUMN airplay_gstreamer_installed BOOLEAN,
    ADD COLUMN airplay_h264_decoder_available BOOLEAN,
    ADD COLUMN airplay_hardware_decode BOOLEAN,
    ADD COLUMN airplay_decoder TEXT,
    ADD COLUMN airplay_max_profile TEXT,
    ADD COLUMN airplay_group_supported BOOLEAN,
    ADD COLUMN airplay_audio_available BOOLEAN,
    ADD COLUMN airplay_avahi_available BOOLEAN,
    ADD COLUMN airplay_mdns_advertisement_available BOOLEAN,
    ADD COLUMN airplay_multicast_supported BOOLEAN,
    ADD COLUMN airplay_multicast_test_status TEXT,
    ADD COLUMN external_presentation_state TEXT,
    ADD COLUMN external_presentation_session_id UUID,
    ADD COLUMN external_presentation_role TEXT,
    ADD COLUMN airplay_receiver_state TEXT,
    ADD COLUMN airplay_transport TEXT,
    ADD COLUMN airplay_connected BOOLEAN,
    ADD COLUMN external_presentation_expires_at TIMESTAMPTZ;

CREATE TABLE external_presentation_sessions (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('airplay')),
    status TEXT NOT NULL CHECK (status IN ('preparing','waiting','active','stopping','ended','expired','failed')),
    target_type TEXT NOT NULL CHECK (target_type IN ('screen','group')),
    target_id UUID NOT NULL,
    gateway_screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE RESTRICT,
    audio_screen_id UUID REFERENCES screens(id) ON DELETE RESTRICT,
    receiver_name TEXT NOT NULL CHECK (char_length(receiver_name) BETWEEN 1 AND 120),
    pin TEXT,
    device_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    end_reason TEXT,
    transport TEXT NOT NULL CHECK (transport IN ('unicast','multicast')),
    multicast_address INET,
    video_port INTEGER NOT NULL DEFAULT 42000 CHECK (video_port BETWEEN 1024 AND 65535),
    audio_port INTEGER NOT NULL DEFAULT 42002 CHECK (audio_port BETWEEN 1024 AND 65535),
    video_profile TEXT NOT NULL CHECK (video_profile IN ('1080p30','720p30')),
    audio_mode TEXT NOT NULL DEFAULT 'gateway_only' CHECK (audio_mode IN ('gateway_only','none','all')),
    CHECK (expires_at > created_at),
    CHECK (pin IS NULL OR pin ~ '^[0-9]{4}$'),
    CHECK (device_id IS NULL OR device_id ~* '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$')
);
CREATE INDEX external_presentation_sessions_active_idx
    ON external_presentation_sessions(status, expires_at)
    WHERE status IN ('preparing','waiting','active','stopping');
CREATE INDEX external_presentation_sessions_target_idx
    ON external_presentation_sessions(target_type, target_id, created_at DESC);
CREATE UNIQUE INDEX external_presentation_sessions_active_multicast_unique
    ON external_presentation_sessions(multicast_address)
    WHERE multicast_address IS NOT NULL
      AND status IN ('preparing','waiting','active','stopping');

CREATE TABLE external_presentation_screen_states (
    session_id UUID NOT NULL REFERENCES external_presentation_sessions(id) ON DELETE CASCADE,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('single','gateway','receiver')),
    state TEXT NOT NULL CHECK (state IN ('preparing','ready','waiting','connected','degraded','failed','stopped')),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    failure_code TEXT,
    safe_failure_message TEXT,
    PRIMARY KEY (session_id, screen_id)
);
CREATE INDEX external_presentation_screen_states_screen_idx
    ON external_presentation_screen_states(screen_id, last_updated_at DESC);

-- +goose Down

DROP TABLE external_presentation_screen_states;
DROP TABLE external_presentation_sessions;

ALTER TABLE screen_player_status
    DROP COLUMN external_presentation_expires_at,
    DROP COLUMN airplay_connected,
    DROP COLUMN airplay_transport,
    DROP COLUMN airplay_receiver_state,
    DROP COLUMN external_presentation_role,
    DROP COLUMN external_presentation_session_id,
    DROP COLUMN external_presentation_state,
    DROP COLUMN airplay_multicast_test_status,
    DROP COLUMN airplay_multicast_supported,
    DROP COLUMN airplay_mdns_advertisement_available,
    DROP COLUMN airplay_avahi_available,
    DROP COLUMN airplay_audio_available,
    DROP COLUMN airplay_group_supported,
    DROP COLUMN airplay_max_profile,
    DROP COLUMN airplay_decoder,
    DROP COLUMN airplay_hardware_decode,
    DROP COLUMN airplay_h264_decoder_available,
    DROP COLUMN airplay_gstreamer_installed,
    DROP COLUMN airplay_uxplay_version,
    DROP COLUMN airplay_uxplay_installed,
    DROP COLUMN airplay_supported;

ALTER TABLE player_commands DROP CONSTRAINT IF EXISTS player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test',
    'install_autostart','remove_autostart'
));

ALTER TABLE screen_groups DROP COLUMN presentation_gateway_screen_id;
