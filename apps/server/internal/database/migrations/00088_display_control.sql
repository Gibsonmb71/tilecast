-- +goose Up

-- Display Control uses the same schedule rows and offline manifest resolver as
-- content. Existing rows remain content schedules; a new row may carry one
-- bounded display action instead of a playlist or layout.
ALTER TABLE schedules
    ALTER COLUMN playlist_id DROP NOT NULL,
    ADD COLUMN display_action JSONB;

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedule_presentation_check;
ALTER TABLE schedules ADD CONSTRAINT schedule_presentation_check CHECK (
    ((playlist_id IS NOT NULL)::integer + (layout_id IS NOT NULL)::integer + (display_action IS NOT NULL)::integer) = 1
);
ALTER TABLE schedules ADD CONSTRAINT schedule_display_action_check CHECK (
    display_action IS NULL OR (jsonb_typeof(display_action) = 'object' AND display_action ? 'type')
);
CREATE INDEX schedules_display_action_idx ON schedules(display_action) WHERE deleted_at IS NULL AND display_action IS NOT NULL;

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
    ADD COLUMN display_control_provider TEXT,
    ADD COLUMN display_control_providers TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN display_control_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN display_power_state TEXT,
    ADD COLUMN display_power_state_confirmed BOOLEAN,
    ADD COLUMN display_power_state_observed_at TIMESTAMPTZ,
    ADD COLUMN display_control_policy_state TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN display_control_last_command_id UUID REFERENCES player_commands(id),
    ADD COLUMN display_control_last_command_state TEXT,
    ADD COLUMN display_control_last_command_result TEXT,
    ADD COLUMN display_control_last_command_sent_at TIMESTAMPTZ,
    ADD COLUMN display_control_last_state_confirmed_at TIMESTAMPTZ,
    ADD COLUMN display_control_error TEXT;
ALTER TABLE screen_player_status ADD CONSTRAINT display_power_state_check CHECK (
    display_power_state IS NULL OR display_power_state IN ('unknown','on','off','transitioning','unsupported')
);
ALTER TABLE screen_player_status ADD CONSTRAINT display_control_policy_state_check CHECK (
    display_control_policy_state IN ('normal','powered_off_by_policy','unknown')
);

-- +goose Down

ALTER TABLE screen_player_status
    DROP CONSTRAINT display_control_policy_state_check,
    DROP CONSTRAINT display_power_state_check,
    DROP COLUMN display_control_error,
    DROP COLUMN display_control_last_state_confirmed_at,
    DROP COLUMN display_control_last_command_sent_at,
    DROP COLUMN display_control_last_command_result,
    DROP COLUMN display_control_last_command_state,
    DROP COLUMN display_control_last_command_id,
    DROP COLUMN display_control_policy_state,
    DROP COLUMN display_power_state_observed_at,
    DROP COLUMN display_power_state_confirmed,
    DROP COLUMN display_power_state,
    DROP COLUMN display_control_capabilities,
    DROP COLUMN display_control_providers,
    DROP COLUMN display_control_provider;

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

DELETE FROM schedules WHERE display_action IS NOT NULL;
DROP INDEX schedules_display_action_idx;
ALTER TABLE schedules DROP CONSTRAINT schedule_display_action_check, DROP CONSTRAINT schedule_presentation_check, DROP COLUMN display_action;
ALTER TABLE schedules ADD CONSTRAINT schedule_presentation_check CHECK ((playlist_id IS NULL) <> (layout_id IS NULL));

