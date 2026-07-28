-- +goose Up

-- Playback sessions did not distinguish a root presentation from the content
-- shown inside it, so summing every session's duration double-counted wall
-- clock whenever two layout zones played at once. They also recorded only a
-- free-text closedReason in metadata, which meant an expected item boundary and
-- a renderer failure both landed in "interrupted plays".

ALTER TABLE playback_sessions
    ADD COLUMN session_type TEXT NOT NULL DEFAULT 'presentation'
        CHECK (session_type IN ('presentation','content','layout_placement','playlist_item')),
    ADD COLUMN terminal_reason TEXT
        CHECK (terminal_reason IS NULL OR terminal_reason IN (
            'expected_item_boundary','completed_duration','schedule_transition','manifest_replacement',
            'direct_assignment_change','emergency_takeover','player_restart','process_exit','heartbeat_gap',
            'renderer_failure','decoder_failure','manual_skip','recovery_action','bounded_timeout','unknown'));

-- Players report the terminal reason on the event that ends a session, so the
-- event stream carries it too and remains the auditable source.
ALTER TABLE player_activity_events
    ADD COLUMN terminal_reason TEXT
        CHECK (terminal_reason IS NULL OR terminal_reason IN (
            'expected_item_boundary','completed_duration','schedule_transition','manifest_replacement',
            'direct_assignment_change','emergency_takeover','player_restart','process_exit','heartbeat_gap',
            'renderer_failure','decoder_failure','manual_skip','recovery_action','bounded_timeout','unknown')),
    ADD COLUMN session_type TEXT
        CHECK (session_type IS NULL OR session_type IN ('presentation','content','layout_placement','playlist_item'));

-- Backfill the session type from the evidence already recorded. A session with
-- a parent, or with its own content identity, is child exposure; everything
-- else is the root presentation interval.
UPDATE playback_sessions
SET session_type = CASE
        WHEN layout_placement_id IS NOT NULL THEN 'layout_placement'
        WHEN playlist_item_id IS NOT NULL THEN 'playlist_item'
        WHEN parent_session_id IS NOT NULL OR content_id IS NOT NULL THEN 'content'
        ELSE 'presentation'
    END;

-- Backfill the terminal reason only from reasons the server itself recorded.
-- Anything else is guesswork, and a guessed cause is worse than no cause: it
-- would silently move sessions in and out of the interruption count.
UPDATE playback_sessions
SET terminal_reason = CASE metadata->>'closedReason'
        WHEN 'heartbeat_gap' THEN 'heartbeat_gap'
        WHEN 'bounded_timeout' THEN 'bounded_timeout'
        WHEN 'incompatible_start' THEN 'manifest_replacement'
        ELSE 'unknown'
    END
WHERE ended_at IS NOT NULL;

CREATE INDEX playback_sessions_type_time_idx
    ON playback_sessions(session_type, started_at DESC, id DESC);
CREATE INDEX playback_sessions_screen_root_idx
    ON playback_sessions(screen_id, started_at, ended_at)
    WHERE session_type = 'presentation';
CREATE INDEX playback_sessions_terminal_reason_idx
    ON playback_sessions(terminal_reason, started_at DESC)
    WHERE terminal_reason IS NOT NULL;

-- +goose Down
DROP INDEX playback_sessions_terminal_reason_idx;
DROP INDEX playback_sessions_screen_root_idx;
DROP INDEX playback_sessions_type_time_idx;
ALTER TABLE player_activity_events
    DROP COLUMN session_type,
    DROP COLUMN terminal_reason;
ALTER TABLE playback_sessions
    DROP COLUMN terminal_reason,
    DROP COLUMN session_type;
