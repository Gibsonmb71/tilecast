-- +goose Up

ALTER TABLE player_commands DROP CONSTRAINT player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test'
));

ALTER TABLE screen_player_status
    ADD COLUMN commissioning_state text,
    ADD COLUMN commissioning_step text,
    ADD COLUMN commissioning_completed_at timestamptz,
    ADD COLUMN cached_fallback_available boolean,
    ADD COLUMN last_healthy_playback_at timestamptz,
    ADD COLUMN last_playlist_transition_at timestamptz,
    ADD COLUMN last_successful_sync_at timestamptz,
    ADD COLUMN last_server_connection_at timestamptz,
    ADD COLUMN boot_attempt_count integer,
    ADD COLUMN boot_last_attempt_at timestamptz,
    ADD COLUMN boot_launch_verified boolean,
    ADD COLUMN update_readiness text,
    ADD COLUMN self_test_result text,
    ADD COLUMN self_test_completed_at timestamptz;

ALTER TABLE update_deployments DROP CONSTRAINT update_deployments_status_check;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_status_check
    CHECK (status IN ('pending','active','paused','cancelled','completed'));
ALTER TABLE update_deployments
    ADD COLUMN rollout_mode text NOT NULL DEFAULT 'full' CHECK (rollout_mode IN ('full','canary')),
    ADD COLUMN rollout_phase text NOT NULL DEFAULT 'full' CHECK (rollout_phase IN ('canary','full','paused','completed')),
    ADD COLUMN canary_size integer NOT NULL DEFAULT 0 CHECK (canary_size >= 0 AND canary_size <= 50),
    ADD COLUMN paused_at timestamptz,
    ADD COLUMN pause_reason text;

ALTER TABLE screen_update_states DROP CONSTRAINT screen_update_states_state_check;
ALTER TABLE screen_update_states ADD CONSTRAINT screen_update_states_state_check CHECK (state IN (
    'held','pending','offline','downloading','downloaded','verifying','ready',
    'waiting_for_permission','waiting_for_user','installing','reconnecting','succeeded',
    'failed','cancelled','incompatible','already_current'
));
ALTER TABLE screen_update_states ADD COLUMN is_canary boolean NOT NULL DEFAULT false;

-- +goose Down

ALTER TABLE screen_update_states DROP COLUMN is_canary;
ALTER TABLE screen_update_states DROP CONSTRAINT screen_update_states_state_check;
ALTER TABLE screen_update_states ADD CONSTRAINT screen_update_states_state_check CHECK (state IN (
    'pending','offline','downloading','downloaded','verifying','ready','waiting_for_permission',
    'waiting_for_user','installing','reconnecting','succeeded','failed','cancelled',
    'incompatible','already_current'
));

ALTER TABLE update_deployments
    DROP COLUMN pause_reason,
    DROP COLUMN paused_at,
    DROP COLUMN canary_size,
    DROP COLUMN rollout_phase,
    DROP COLUMN rollout_mode;
ALTER TABLE update_deployments DROP CONSTRAINT update_deployments_status_check;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_status_check
    CHECK (status IN ('pending','active','cancelled','completed'));

ALTER TABLE screen_player_status
    DROP COLUMN self_test_completed_at,
    DROP COLUMN self_test_result,
    DROP COLUMN update_readiness,
    DROP COLUMN boot_launch_verified,
    DROP COLUMN boot_last_attempt_at,
    DROP COLUMN boot_attempt_count,
    DROP COLUMN last_server_connection_at,
    DROP COLUMN last_successful_sync_at,
    DROP COLUMN last_playlist_transition_at,
    DROP COLUMN last_healthy_playback_at,
    DROP COLUMN cached_fallback_available,
    DROP COLUMN commissioning_completed_at,
    DROP COLUMN commissioning_step,
    DROP COLUMN commissioning_state;

ALTER TABLE player_commands DROP CONSTRAINT player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake'
));
