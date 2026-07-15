-- +goose Up
CREATE TABLE playback_sessions (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    group_id UUID REFERENCES screen_groups(id) ON DELETE SET NULL,
    parent_session_id UUID REFERENCES playback_sessions(id) ON DELETE SET NULL,
    activity_session_id TEXT NOT NULL,
    start_event_id UUID REFERENCES player_activity_events(id) ON DELETE SET NULL,
    end_event_id UUID REFERENCES player_activity_events(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    presentation_type TEXT,
    presentation_id TEXT,
    presentation_revision TEXT,
    presentation_name TEXT,
    content_type TEXT,
    content_id TEXT,
    content_name TEXT,
    playlist_item_id TEXT,
    layout_placement_id TEXT,
    actual_duration_ms BIGINT CHECK (actual_duration_ms IS NULL OR actual_duration_ms >= 0),
    expected_duration_ms BIGINT CHECK (expected_duration_ms IS NULL OR expected_duration_ms >= 0),
    result TEXT NOT NULL DEFAULT 'playing' CHECK (result IN ('playing','completed','partial','skipped','failed','unknown','recovered')),
    trigger_context TEXT,
    schedule_id TEXT,
    emergency_id TEXT,
    manifest_version BIGINT,
    failure_code TEXT,
    source_id TEXT,
    selected_record_id TEXT,
    selection_date DATE,
    source_cached_at TIMESTAMPTZ,
    source_revision TEXT,
    snapshot_hash TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (screen_id, activity_session_id)
);
CREATE INDEX playback_sessions_time_idx ON playback_sessions(started_at DESC, id DESC);
CREATE INDEX playback_sessions_screen_time_idx ON playback_sessions(screen_id, started_at DESC, id DESC);
CREATE INDEX playback_sessions_content_idx ON playback_sessions(content_id, started_at DESC) WHERE content_id IS NOT NULL;
CREATE INDEX playback_sessions_presentation_idx ON playback_sessions(presentation_id, started_at DESC) WHERE presentation_id IS NOT NULL;
CREATE INDEX playback_sessions_schedule_idx ON playback_sessions(schedule_id, started_at DESC) WHERE schedule_id IS NOT NULL;
CREATE INDEX playback_sessions_result_idx ON playback_sessions(result, started_at DESC, id DESC);
CREATE INDEX playback_sessions_open_idx ON playback_sessions(screen_id, started_at) WHERE ended_at IS NULL;
CREATE TABLE screen_state_intervals (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('online','offline','healthy','degraded','unknown','safe_mode')),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    start_event_id UUID REFERENCES player_activity_events(id) ON DELETE SET NULL,
    end_event_id UUID REFERENCES player_activity_events(id) ON DELETE SET NULL,
    reason_code TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (screen_id, started_at, state)
);
CREATE INDEX screen_state_intervals_screen_time_idx ON screen_state_intervals(screen_id, started_at DESC, id DESC);
CREATE INDEX screen_state_intervals_open_idx ON screen_state_intervals(screen_id, state) WHERE ended_at IS NULL;
-- +goose Down
DROP TABLE screen_state_intervals;
DROP TABLE playback_sessions;
