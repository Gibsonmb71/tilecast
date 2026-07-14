-- +goose Up

-- Earlier development builds changed the player-update schema in already-numbered
-- migrations. Existing installations may therefore report the latest Goose
-- version while still carrying an older constraint or missing a later column.
-- Re-assert the current schema in a new migration so deployments do not fail in
-- the middle of a transaction.

ALTER TABLE update_deployments
    ADD COLUMN IF NOT EXISTS rollout_mode text NOT NULL DEFAULT 'full',
    ADD COLUMN IF NOT EXISTS rollout_phase text NOT NULL DEFAULT 'full',
    ADD COLUMN IF NOT EXISTS canary_size integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paused_at timestamptz,
    ADD COLUMN IF NOT EXISTS pause_reason text;

ALTER TABLE update_deployments DROP CONSTRAINT IF EXISTS update_deployments_status_check;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_status_check
    CHECK (status IN ('pending','active','paused','cancelled','completed'));

ALTER TABLE update_deployments DROP CONSTRAINT IF EXISTS update_deployments_rollout_mode_check;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_rollout_mode_check
    CHECK (rollout_mode IN ('full','canary'));

ALTER TABLE update_deployments DROP CONSTRAINT IF EXISTS update_deployments_rollout_phase_check;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_rollout_phase_check
    CHECK (rollout_phase IN ('canary','full','paused','completed'));

ALTER TABLE update_deployments DROP CONSTRAINT IF EXISTS update_deployments_canary_size_check;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_canary_size_check
    CHECK (canary_size >= 0 AND canary_size <= 50);

ALTER TABLE screen_update_states
    ADD COLUMN IF NOT EXISTS is_canary boolean NOT NULL DEFAULT false;

ALTER TABLE screen_update_states DROP CONSTRAINT IF EXISTS screen_update_states_state_check;
ALTER TABLE screen_update_states ADD CONSTRAINT screen_update_states_state_check CHECK (state IN (
    'held','pending','offline','downloading','downloaded','verifying','ready',
    'waiting_for_permission','waiting_for_user','installing','reconnecting','succeeded',
    'failed','cancelled','incompatible','already_current'
));

ALTER TABLE player_commands DROP CONSTRAINT IF EXISTS player_commands_type_check;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_type_check CHECK (type IN (
    'sync_now','reload_playback','identify_screen','clear_media_cache','clear_website_data',
    'disable_playback','enable_playback','install_player_update','retry_player_recovery',
    'exit_safe_mode','power_assist_sleep','power_assist_wake','retry_current_item',
    'skip_current_item','recreate_renderer','recreate_playback_session','restart_activity',
    'restart_player_process','resynchronize_player','run_player_self_test'
));

-- +goose Down

-- This migration repairs schema drift on existing installations. Reversing it
-- would recreate the drift, so the down migration intentionally leaves the
-- repaired schema in place.
SELECT 1;
