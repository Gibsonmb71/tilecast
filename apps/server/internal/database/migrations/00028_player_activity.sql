-- +goose Up
CREATE TABLE player_activity_events (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    sequence BIGINT CHECK (sequence IS NULL OR sequence > 0),
    origin TEXT NOT NULL DEFAULT 'player' CHECK (origin IN ('player','server')),
    event_type TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('debug','info','warning','error','critical')),
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    elapsed_realtime_ms BIGINT,
    player_timezone TEXT NOT NULL DEFAULT 'UTC',
    manifest_version BIGINT,
    presentation_type TEXT,
    presentation_id TEXT,
    presentation_revision TEXT,
    content_type TEXT,
    content_id TEXT,
    playlist_item_id TEXT,
    layout_placement_id TEXT,
    activity_session_id TEXT,
    result TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('playing','completed','partial','skipped','failed','unknown','recovered','success')),
    duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
    expected_duration_ms BIGINT CHECK (expected_duration_ms IS NULL OR expected_duration_ms >= 0),
    failure_code TEXT,
    failure_message TEXT,
    trigger_context TEXT,
    schedule_id TEXT,
    emergency_id TEXT,
    source_id TEXT,
    selected_record_id TEXT,
    selection_date DATE,
    source_cached_at TIMESTAMPTZ,
    source_revision TEXT,
    snapshot_hash TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    priority SMALLINT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 0 AND 9),
    UNIQUE (screen_id, sequence)
);
CREATE INDEX player_activity_events_screen_time_idx ON player_activity_events(screen_id, occurred_at DESC, sequence DESC);
CREATE INDEX player_activity_events_time_idx ON player_activity_events(occurred_at DESC, id DESC);
CREATE INDEX player_activity_events_category_idx ON player_activity_events(category, occurred_at DESC, id DESC);
CREATE INDEX player_activity_events_result_idx ON player_activity_events(result, occurred_at DESC, id DESC);
CREATE INDEX player_activity_events_session_idx ON player_activity_events(screen_id, activity_session_id) WHERE activity_session_id IS NOT NULL;


-- Server-side operational events are written immediately for actions that exist
-- before the Player can report them. State transitions reported by the Player
-- are added by the heartbeat transition detector.
CREATE OR REPLACE FUNCTION tilecast_activity_command_created() RETURNS trigger AS $$
BEGIN
    INSERT INTO player_activity_events(
        id,screen_id,sequence,origin,event_type,category,severity,occurred_at,
        player_timezone,result,content_type,content_id,metadata,priority
    ) VALUES (
        gen_random_uuid(),NEW.screen_id,NULL,'server','command.created','commands','info',NEW.created_at,
        'UTC','success','command',NEW.id::text,
        jsonb_build_object('commandType',NEW.type,'expiresAt',NEW.expires_at),8
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER player_commands_activity_created
AFTER INSERT ON player_commands
FOR EACH ROW EXECUTE FUNCTION tilecast_activity_command_created();

CREATE OR REPLACE FUNCTION tilecast_activity_update_assigned() RETURNS trigger AS $$
BEGIN
    INSERT INTO player_activity_events(
        id,screen_id,sequence,origin,event_type,category,severity,occurred_at,
        player_timezone,result,content_type,content_id,metadata,priority
    ) VALUES (
        gen_random_uuid(),NEW.screen_id,NULL,'server','update.assigned','updates','info',now(),
        'UTC','success','update_deployment',NEW.deployment_id::text,
        jsonb_build_object('expectedVersionCode',NEW.expected_version_code,'state',NEW.state),8
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER screen_update_states_activity_assigned
AFTER INSERT ON screen_update_states
FOR EACH ROW EXECUTE FUNCTION tilecast_activity_update_assigned();

CREATE OR REPLACE FUNCTION tilecast_activity_emergency_assigned() RETURNS trigger AS $$
BEGIN
    INSERT INTO player_activity_events(
        id,screen_id,sequence,origin,event_type,category,severity,occurred_at,
        player_timezone,result,emergency_id,content_type,content_id,metadata,priority
    ) VALUES (
        gen_random_uuid(),NEW.screen_id,NULL,'server','emergency.assigned','emergencies','warning',now(),
        'UTC','success',NEW.emergency_id::text,'emergency',NEW.emergency_id::text,
        jsonb_build_object('manifestVersion',NEW.manifest_version,'state',NEW.state),9
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER emergency_screen_states_activity_assigned
AFTER INSERT ON emergency_screen_states
FOR EACH ROW EXECUTE FUNCTION tilecast_activity_emergency_assigned();


-- +goose Down
DROP TRIGGER emergency_screen_states_activity_assigned ON emergency_screen_states;
DROP FUNCTION tilecast_activity_emergency_assigned();
DROP TRIGGER screen_update_states_activity_assigned ON screen_update_states;
DROP FUNCTION tilecast_activity_update_assigned();
DROP TRIGGER player_commands_activity_created ON player_commands;
DROP FUNCTION tilecast_activity_command_created();
DROP TABLE player_activity_events;
