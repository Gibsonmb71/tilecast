-- +goose Up

-- In-product systemd autostart for the Linux player.
--
-- Boot launch on Linux was previously an out-of-band setup step: an operator
-- hand-installed a systemd user unit on the device, and nothing about it was
-- ever reported back, so Studio's "Launch after boot" row read "not verified"
-- on every Linux screen no matter how the device was configured. These two
-- commands let the player install and remove that unit itself, and the columns
-- below record what it finds so the row means something.

ALTER TABLE player_commands DROP CONSTRAINT IF EXISTS player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test',
    'install_autostart','remove_autostart'
));

ALTER TABLE screen_player_status
    -- unknown | not_installed | installed | needs_attention | unsupported
    ADD COLUMN autostart_state text,
    -- graphical-session.target or default.target, whichever the session provides
    ADD COLUMN autostart_target text,
    -- whether the running player was started by systemd (INVOCATION_ID present)
    ADD COLUMN autostart_supervised boolean,
    -- loginctl linger: whether the user manager survives logout
    ADD COLUMN autostart_linger_enabled boolean,
    ADD COLUMN autostart_error text;

-- +goose Down

ALTER TABLE screen_player_status
    DROP COLUMN autostart_state,
    DROP COLUMN autostart_target,
    DROP COLUMN autostart_supervised,
    DROP COLUMN autostart_linger_enabled,
    DROP COLUMN autostart_error;

DELETE FROM player_commands WHERE type IN ('install_autostart','remove_autostart');

ALTER TABLE player_commands DROP CONSTRAINT IF EXISTS player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test'
));
