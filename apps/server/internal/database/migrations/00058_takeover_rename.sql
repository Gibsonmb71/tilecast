-- +goose Up

-- "Emergency takeover" is now just "Takeover". The feature is an explicit,
-- temporary fullscreen override; it is used for far more than emergencies, and
-- the old name made the separate NWS emergency-alert monitoring introduced
-- alongside this migration read as the same thing. The rename is deliberately
-- carried all the way through storage rather than being papered over in the
-- dashboard, so schema, API, manifest, and player all speak one vocabulary.
--
-- Renames only. No row is created or destroyed here, and every historical
-- takeover, activity event, audit entry, and compliance window keeps its
-- identity and its timestamps.

ALTER TABLE emergency_takeovers RENAME TO takeovers;
ALTER TABLE emergency_targets RENAME TO takeover_targets;
ALTER TABLE emergency_screen_states RENAME TO takeover_screen_states;

ALTER TABLE takeover_targets RENAME COLUMN emergency_id TO takeover_id;
ALTER TABLE takeover_screen_states RENAME COLUMN emergency_id TO takeover_id;

ALTER INDEX emergency_screen_target_unique RENAME TO takeover_screen_target_unique;
ALTER INDEX emergency_group_target_unique RENAME TO takeover_group_target_unique;

ALTER TRIGGER emergency_targets_reject_archived ON takeover_targets
    RENAME TO takeover_targets_reject_archived;

ALTER TABLE screen_player_status
    RENAME COLUMN active_emergency_id TO active_takeover_id;
ALTER TABLE screen_player_status
    RENAME COLUMN emergency_state TO takeover_state;
ALTER TABLE screen_player_status
    RENAME COLUMN emergency_preparation_progress TO takeover_preparation_progress;

ALTER TABLE player_activity_events RENAME COLUMN emergency_id TO takeover_id;
ALTER TABLE playback_sessions RENAME COLUMN emergency_id TO takeover_id;
ALTER TABLE expected_playback_windows
    RENAME COLUMN overridden_by_emergency_id TO overridden_by_takeover_id;

-- The activity trigger writes the vocabulary the reports filter on, so it has
-- to be replaced rather than renamed.
ALTER TRIGGER emergency_screen_states_activity_assigned ON takeover_screen_states
    RENAME TO takeover_screen_states_activity_assigned;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION tilecast_activity_emergency_assigned() RETURNS trigger AS $$
BEGIN
    INSERT INTO player_activity_events(id,screen_id,sequence,origin,event_type,category,severity,occurred_at,player_timezone,result,takeover_id,content_type,content_id,metadata,priority)
    VALUES (gen_random_uuid(),NEW.screen_id,NULL,'server','takeover.assigned','takeovers','warning',now(),'UTC','success',NEW.takeover_id::text,'takeover',NEW.takeover_id::text,jsonb_build_object('manifestVersion',NEW.manifest_version,'state',NEW.state),9);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

ALTER FUNCTION tilecast_activity_emergency_assigned() RENAME TO tilecast_activity_takeover_assigned;

-- Closed-set values recorded against takeovers. Each constraint is rebuilt with
-- the new vocabulary after the stored rows are rewritten, so no row is ever
-- transiently in violation.

UPDATE playback_sessions SET terminal_reason='takeover' WHERE terminal_reason='emergency_takeover';
ALTER TABLE playback_sessions DROP CONSTRAINT playback_sessions_terminal_reason_check;
ALTER TABLE playback_sessions ADD CONSTRAINT playback_sessions_terminal_reason_check
    CHECK (terminal_reason IS NULL OR terminal_reason IN (
        'expected_item_boundary','completed_duration','schedule_transition','manifest_replacement',
        'direct_assignment_change','takeover','player_restart','process_exit','heartbeat_gap',
        'renderer_failure','decoder_failure','manual_skip','recovery_action','bounded_timeout','unknown')) NOT VALID;

UPDATE player_activity_events SET terminal_reason='takeover' WHERE terminal_reason='emergency_takeover';
ALTER TABLE player_activity_events DROP CONSTRAINT player_activity_events_terminal_reason_check;
ALTER TABLE player_activity_events ADD CONSTRAINT player_activity_events_terminal_reason_check
    CHECK (terminal_reason IS NULL OR terminal_reason IN (
        'expected_item_boundary','completed_duration','schedule_transition','manifest_replacement',
        'direct_assignment_change','takeover','player_restart','process_exit','heartbeat_gap',
        'renderer_failure','decoder_failure','manual_skip','recovery_action','bounded_timeout','unknown')) NOT VALID;

UPDATE expected_playback_windows SET superseded_reason='takeover_started' WHERE superseded_reason='emergency_started';
UPDATE expected_playback_windows SET superseded_reason='takeover_ended' WHERE superseded_reason='emergency_ended';
ALTER TABLE expected_playback_windows DROP CONSTRAINT expected_playback_windows_superseded_reason_check;
ALTER TABLE expected_playback_windows ADD CONSTRAINT expected_playback_windows_superseded_reason_check
    CHECK (superseded_reason IS NULL OR superseded_reason IN (
        'assignment_changed','schedule_started','schedule_ended','manifest_changed',
        'takeover_started','takeover_ended','screen_disabled','active_hours_changed',
        'deployment_suppressed_playback','screen_archived')) NOT VALID;

UPDATE expected_playback_windows SET match_status='overridden_by_takeover' WHERE match_status='overridden_by_emergency';
ALTER TABLE expected_playback_windows DROP CONSTRAINT expected_playback_windows_match_status_check;
ALTER TABLE expected_playback_windows ADD CONSTRAINT expected_playback_windows_match_status_check
    CHECK (match_status IN (
        'confirmed','started_late','ended_early','partial','failed','never_started',
        'screen_offline','overridden_by_takeover','cancelled','not_measurable')) NOT VALID;

ALTER TABLE playback_sessions VALIDATE CONSTRAINT playback_sessions_terminal_reason_check;
ALTER TABLE player_activity_events VALIDATE CONSTRAINT player_activity_events_terminal_reason_check;
ALTER TABLE expected_playback_windows VALIDATE CONSTRAINT expected_playback_windows_superseded_reason_check;
ALTER TABLE expected_playback_windows VALIDATE CONSTRAINT expected_playback_windows_match_status_check;

UPDATE expected_playback_windows SET trigger_source='takeover' WHERE trigger_source='emergency';

-- Free-text vocabulary the reports and the dashboard filter on.
UPDATE screen_player_status SET selection_source='takeover' WHERE selection_source='emergency';
UPDATE screen_manifest_state SET change_reason='takeover.'||split_part(change_reason,'.',2) WHERE change_reason LIKE 'emergency.%';
UPDATE player_activity_events SET category='takeovers' WHERE category='emergencies';
UPDATE player_activity_events SET event_type='takeover.'||split_part(event_type,'.',2) WHERE event_type LIKE 'emergency.%';
UPDATE player_activity_events SET content_type='takeover' WHERE content_type='emergency';
UPDATE playback_sessions SET content_type='takeover' WHERE content_type='emergency';
UPDATE audit_logs SET action='takeover.'||split_part(action,'.',2) WHERE action LIKE 'emergency.%';
UPDATE audit_logs SET resource_type='takeover' WHERE resource_type='emergency';

-- Organization runtime settings are a JSONB document keyed by setting key.
UPDATE organization_runtime_settings SET settings = (
    SELECT COALESCE(jsonb_object_agg(
        CASE
            WHEN key LIKE 'emergency.%' THEN 'takeover.'||substring(key from 11)
            WHEN key = 'retention.emergency_history_days' THEN 'retention.takeover_history_days'
            ELSE key
        END, value), '{}'::jsonb)
    FROM jsonb_each(settings)
), revision = revision + 1, updated_at = now()
WHERE EXISTS (
    SELECT 1 FROM jsonb_each(settings) entry
    WHERE entry.key LIKE 'emergency.%' OR entry.key = 'retention.emergency_history_days'
);

-- +goose Down

UPDATE organization_runtime_settings SET settings = (
    SELECT COALESCE(jsonb_object_agg(
        CASE
            WHEN key LIKE 'takeover.%' THEN 'emergency.'||substring(key from 10)
            WHEN key = 'retention.takeover_history_days' THEN 'retention.emergency_history_days'
            ELSE key
        END, value), '{}'::jsonb)
    FROM jsonb_each(settings)
), revision = revision + 1, updated_at = now()
WHERE EXISTS (
    SELECT 1 FROM jsonb_each(settings) entry
    WHERE entry.key LIKE 'takeover.%' OR entry.key = 'retention.takeover_history_days'
);

UPDATE audit_logs SET resource_type='emergency' WHERE resource_type='takeover';
UPDATE audit_logs SET action='emergency.'||split_part(action,'.',2) WHERE action LIKE 'takeover.%';
UPDATE playback_sessions SET content_type='emergency' WHERE content_type='takeover';
UPDATE player_activity_events SET content_type='emergency' WHERE content_type='takeover';
UPDATE player_activity_events SET event_type='emergency.'||split_part(event_type,'.',2) WHERE event_type LIKE 'takeover.%';
UPDATE player_activity_events SET category='emergencies' WHERE category='takeovers';
UPDATE screen_manifest_state SET change_reason='emergency.'||split_part(change_reason,'.',2) WHERE change_reason LIKE 'takeover.%';
UPDATE screen_player_status SET selection_source='emergency' WHERE selection_source='takeover';

UPDATE expected_playback_windows SET trigger_source='emergency' WHERE trigger_source='takeover';

UPDATE expected_playback_windows SET match_status='overridden_by_emergency' WHERE match_status='overridden_by_takeover';
ALTER TABLE expected_playback_windows DROP CONSTRAINT expected_playback_windows_match_status_check;
ALTER TABLE expected_playback_windows ADD CONSTRAINT expected_playback_windows_match_status_check
    CHECK (match_status IN (
        'confirmed','started_late','ended_early','partial','failed','never_started',
        'screen_offline','overridden_by_emergency','cancelled','not_measurable')) NOT VALID;

UPDATE expected_playback_windows SET superseded_reason='emergency_ended' WHERE superseded_reason='takeover_ended';
UPDATE expected_playback_windows SET superseded_reason='emergency_started' WHERE superseded_reason='takeover_started';
ALTER TABLE expected_playback_windows DROP CONSTRAINT expected_playback_windows_superseded_reason_check;
ALTER TABLE expected_playback_windows ADD CONSTRAINT expected_playback_windows_superseded_reason_check
    CHECK (superseded_reason IS NULL OR superseded_reason IN (
        'assignment_changed','schedule_started','schedule_ended','manifest_changed',
        'emergency_started','emergency_ended','screen_disabled','active_hours_changed',
        'deployment_suppressed_playback','screen_archived')) NOT VALID;

UPDATE player_activity_events SET terminal_reason='emergency_takeover' WHERE terminal_reason='takeover';
ALTER TABLE player_activity_events DROP CONSTRAINT player_activity_events_terminal_reason_check;
ALTER TABLE player_activity_events ADD CONSTRAINT player_activity_events_terminal_reason_check
    CHECK (terminal_reason IS NULL OR terminal_reason IN (
        'expected_item_boundary','completed_duration','schedule_transition','manifest_replacement',
        'direct_assignment_change','emergency_takeover','player_restart','process_exit','heartbeat_gap',
        'renderer_failure','decoder_failure','manual_skip','recovery_action','bounded_timeout','unknown')) NOT VALID;

UPDATE playback_sessions SET terminal_reason='emergency_takeover' WHERE terminal_reason='takeover';
ALTER TABLE playback_sessions DROP CONSTRAINT playback_sessions_terminal_reason_check;
ALTER TABLE playback_sessions ADD CONSTRAINT playback_sessions_terminal_reason_check
    CHECK (terminal_reason IS NULL OR terminal_reason IN (
        'expected_item_boundary','completed_duration','schedule_transition','manifest_replacement',
        'direct_assignment_change','emergency_takeover','player_restart','process_exit','heartbeat_gap',
        'renderer_failure','decoder_failure','manual_skip','recovery_action','bounded_timeout','unknown')) NOT VALID;

ALTER TABLE expected_playback_windows VALIDATE CONSTRAINT expected_playback_windows_match_status_check;
ALTER TABLE expected_playback_windows VALIDATE CONSTRAINT expected_playback_windows_superseded_reason_check;
ALTER TABLE player_activity_events VALIDATE CONSTRAINT player_activity_events_terminal_reason_check;
ALTER TABLE playback_sessions VALIDATE CONSTRAINT playback_sessions_terminal_reason_check;

ALTER TRIGGER takeover_screen_states_activity_assigned ON takeover_screen_states
    RENAME TO emergency_screen_states_activity_assigned;

ALTER TABLE expected_playback_windows
    RENAME COLUMN overridden_by_takeover_id TO overridden_by_emergency_id;
ALTER TABLE playback_sessions RENAME COLUMN takeover_id TO emergency_id;
ALTER TABLE player_activity_events RENAME COLUMN takeover_id TO emergency_id;

ALTER TABLE screen_player_status
    RENAME COLUMN takeover_preparation_progress TO emergency_preparation_progress;
ALTER TABLE screen_player_status
    RENAME COLUMN takeover_state TO emergency_state;
ALTER TABLE screen_player_status
    RENAME COLUMN active_takeover_id TO active_emergency_id;

ALTER TRIGGER takeover_targets_reject_archived ON takeover_targets
    RENAME TO emergency_targets_reject_archived;

ALTER INDEX takeover_group_target_unique RENAME TO emergency_group_target_unique;
ALTER INDEX takeover_screen_target_unique RENAME TO emergency_screen_target_unique;

ALTER TABLE takeover_screen_states RENAME COLUMN takeover_id TO emergency_id;
ALTER TABLE takeover_targets RENAME COLUMN takeover_id TO emergency_id;

ALTER TABLE takeover_screen_states RENAME TO emergency_screen_states;
ALTER TABLE takeover_targets RENAME TO emergency_targets;
ALTER TABLE takeovers RENAME TO emergency_takeovers;

-- Restored last so its body refers to names that exist in the restored schema.
ALTER FUNCTION tilecast_activity_takeover_assigned() RENAME TO tilecast_activity_emergency_assigned;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION tilecast_activity_emergency_assigned() RETURNS trigger AS $$
BEGIN
    INSERT INTO player_activity_events(id,screen_id,sequence,origin,event_type,category,severity,occurred_at,player_timezone,result,emergency_id,content_type,content_id,metadata,priority)
    VALUES (gen_random_uuid(),NEW.screen_id,NULL,'server','emergency.assigned','emergencies','warning',now(),'UTC','success',NEW.emergency_id::text,'emergency',NEW.emergency_id::text,jsonb_build_object('manifestVersion',NEW.manifest_version,'state',NEW.state),9);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
