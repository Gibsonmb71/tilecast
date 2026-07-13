-- +goose Up

ALTER TABLE player_commands DROP CONSTRAINT player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake'
));

ALTER TABLE screen_player_status
    ADD COLUMN configured_reliability_mode text,
    ADD COLUMN effective_reliability_mode text,
    ADD COLUMN foreground_state text,
    ADD COLUMN last_foreground_exit_at timestamptz,
    ADD COLUMN last_foreground_package text,
    ADD COLUMN boot_recovery_result text,
    ADD COLUMN last_successful_cold_boot_at timestamptz,
    ADD COLUMN immersive_mode_active boolean,
    ADD COLUMN keep_screen_on boolean,
    ADD COLUMN managed_kiosk_capability text,
    ADD COLUMN device_owner_state text,
    ADD COLUMN lock_task_state text,
    ADD COLUMN accessibility_service_state text,
    ADD COLUMN accessibility_return_state text,
    ADD COLUMN accessibility_return_attempts integer,
    ADD COLUMN active_hours_state text,
    ADD COLUMN sleep_capability text,
    ADD COLUMN last_sleep_request_result text,
    ADD COLUMN last_wake_result text,
    ADD COLUMN recovery_level integer,
    ADD COLUMN recovery_count integer,
    ADD COLUMN safe_mode boolean NOT NULL DEFAULT false,
    ADD COLUMN last_watchdog_failure text,
    ADD COLUMN last_watchdog_recovery_at timestamptz,
    ADD COLUMN maintenance_session_expires_at timestamptz,
    ADD COLUMN admin_pin_changed_at timestamptz;

CREATE TABLE screen_power_assist_results (
    screen_id uuid PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    device_sleep text NOT NULL DEFAULT 'untested' CHECK (device_sleep IN ('untested','confirmed_working','partially_working','failed','unsupported')),
    tv_standby text NOT NULL DEFAULT 'untested' CHECK (tv_standby IN ('untested','confirmed_working','partially_working','failed','unsupported')),
    device_wake text NOT NULL DEFAULT 'untested' CHECK (device_wake IN ('untested','confirmed_working','partially_working','failed','unsupported')),
    tv_wake text NOT NULL DEFAULT 'untested' CHECK (tv_wake IN ('untested','confirmed_working','partially_working','failed','unsupported')),
    input_selection text NOT NULL DEFAULT 'untested' CHECK (input_selection IN ('untested','confirmed_working','partially_working','failed','unsupported')),
    tilecast_startup text NOT NULL DEFAULT 'untested' CHECK (tilecast_startup IN ('untested','confirmed_working','partially_working','failed','unsupported')),
    last_tested_at timestamptz,
    updated_by uuid REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down

DROP TABLE screen_power_assist_results;
ALTER TABLE screen_player_status
    DROP COLUMN admin_pin_changed_at,
    DROP COLUMN maintenance_session_expires_at,
    DROP COLUMN last_watchdog_recovery_at,
    DROP COLUMN last_watchdog_failure,
    DROP COLUMN safe_mode,
    DROP COLUMN recovery_count,
    DROP COLUMN recovery_level,
    DROP COLUMN last_wake_result,
    DROP COLUMN last_sleep_request_result,
    DROP COLUMN sleep_capability,
    DROP COLUMN active_hours_state,
    DROP COLUMN accessibility_return_attempts,
    DROP COLUMN accessibility_return_state,
    DROP COLUMN accessibility_service_state,
    DROP COLUMN lock_task_state,
    DROP COLUMN device_owner_state,
    DROP COLUMN managed_kiosk_capability,
    DROP COLUMN keep_screen_on,
    DROP COLUMN immersive_mode_active,
    DROP COLUMN last_successful_cold_boot_at,
    DROP COLUMN boot_recovery_result,
    DROP COLUMN last_foreground_package,
    DROP COLUMN last_foreground_exit_at,
    DROP COLUMN foreground_state,
    DROP COLUMN effective_reliability_mode,
    DROP COLUMN configured_reliability_mode;
ALTER TABLE player_commands DROP CONSTRAINT player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN ('sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data','disable_playback','enable_playback','install_player_update'));
