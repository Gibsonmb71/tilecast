-- +goose Up
-- Closing replacement sessions at the storage boundary keeps synchronous and
-- future worker-based derivation idempotent. An INSERT that conflicts with the
-- existing screen/session key never fires this trigger.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION tilecast_close_replaced_playback_session() RETURNS trigger AS $$
BEGIN
    IF NEW.parent_session_id IS NULL THEN
        UPDATE playback_sessions
        SET ended_at = NEW.started_at,
            result = 'partial',
            actual_duration_ms = GREATEST(0, EXTRACT(EPOCH FROM (NEW.started_at - started_at)) * 1000)::bigint,
            metadata = metadata || '{"closedReason":"replacement_presentation"}'::jsonb,
            updated_at = now()
        WHERE screen_id = NEW.screen_id
          AND ended_at IS NULL
          AND activity_session_id <> NEW.activity_session_id;
    ELSE
        UPDATE playback_sessions
        SET ended_at = NEW.started_at,
            result = 'partial',
            actual_duration_ms = GREATEST(0, EXTRACT(EPOCH FROM (NEW.started_at - started_at)) * 1000)::bigint,
            metadata = metadata || '{"closedReason":"replacement_in_slot"}'::jsonb,
            updated_at = now()
        WHERE screen_id = NEW.screen_id
          AND parent_session_id = NEW.parent_session_id
          AND ended_at IS NULL
          AND activity_session_id <> NEW.activity_session_id
          AND (
              (NEW.layout_placement_id IS NOT NULL AND layout_placement_id = NEW.layout_placement_id)
              OR (NEW.layout_placement_id IS NULL AND layout_placement_id IS NULL)
          );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER playback_sessions_close_replaced
BEFORE INSERT ON playback_sessions
FOR EACH ROW EXECUTE FUNCTION tilecast_close_replaced_playback_session();

-- A fresh connection or explicit playback-process restart is evidence that any
-- still-open interval from the prior process can no longer be proven complete.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION tilecast_close_sessions_after_player_restart() RETURNS trigger AS $$
BEGIN
    IF NEW.event_type IN ('player.connected','connection.restored','playback.session_restarted','boot.recovery') THEN
        UPDATE playback_sessions
        SET ended_at = NEW.occurred_at,
            result = 'unknown',
            actual_duration_ms = GREATEST(0, EXTRACT(EPOCH FROM (NEW.occurred_at - started_at)) * 1000)::bigint,
            metadata = metadata || jsonb_build_object('closedReason', NEW.event_type),
            updated_at = now()
        WHERE screen_id = NEW.screen_id
          AND ended_at IS NULL
          AND started_at <= NEW.occurred_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER player_activity_close_restart_sessions
AFTER INSERT ON player_activity_events
FOR EACH ROW EXECUTE FUNCTION tilecast_close_sessions_after_player_restart();

-- +goose Down
DROP TRIGGER player_activity_close_restart_sessions ON player_activity_events;
DROP FUNCTION tilecast_close_sessions_after_player_restart();
DROP TRIGGER playback_sessions_close_replaced ON playback_sessions;
DROP FUNCTION tilecast_close_replaced_playback_session();
