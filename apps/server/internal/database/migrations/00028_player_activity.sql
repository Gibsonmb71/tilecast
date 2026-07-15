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

-- +goose Down
DROP TABLE player_activity_events;
