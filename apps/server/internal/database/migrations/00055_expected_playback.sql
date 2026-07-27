-- +goose Up

-- Compliance cannot be computed from current schedules and assignments: both
-- change after the fact, so reconstructing last month's expectation from
-- today's configuration would report against a plan that never existed at the
-- time. Expected windows are therefore materialized when a selection becomes
-- effective, and are immutable once written — a change supersedes a window
-- rather than editing it.

CREATE TABLE expected_playback_windows (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,

    presentation_type TEXT NOT NULL DEFAULT '',
    presentation_id TEXT NOT NULL DEFAULT '',
    presentation_revision TEXT NOT NULL DEFAULT '',
    manifest_version BIGINT,
    schedule_id TEXT NOT NULL DEFAULT '',
    -- schedule, direct, emergency, or manual: what selected this content.
    trigger_source TEXT NOT NULL DEFAULT 'direct',

    expected_start TIMESTAMPTZ NOT NULL,
    -- Open-ended while the selection is in force; closed when superseded.
    expected_end TIMESTAMPTZ,
    -- The zone the window was computed in, recorded because a later timezone
    -- change must not silently move a historical expectation.
    timezone TEXT NOT NULL DEFAULT 'UTC',

    -- The emergency that overrode this window, when one did. Overridden time
    -- is not missed normal playback and must not be counted as such.
    overridden_by_emergency_id UUID REFERENCES emergency_takeovers(id) ON DELETE SET NULL,
    -- Optional and only when deterministic. A playlist that loops does not
    -- have a knowable item at a given second, so this stays empty.
    expected_content_type TEXT NOT NULL DEFAULT '',
    expected_content_id TEXT NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at TIMESTAMPTZ,
    -- Why the window stopped applying, from the closed set the server records.
    superseded_reason TEXT
        CHECK (superseded_reason IS NULL OR superseded_reason IN (
            'assignment_changed','schedule_started','schedule_ended','manifest_changed',
            'emergency_started','emergency_ended','screen_disabled','active_hours_changed',
            'deployment_suppressed_playback','screen_archived')),

    -- Populated by the matcher; see docs/activity.md.
    match_status TEXT NOT NULL DEFAULT 'not_measurable'
        CHECK (match_status IN (
            'confirmed','started_late','ended_early','partial','failed','never_started',
            'screen_offline','overridden_by_emergency','cancelled','not_measurable')),
    matched_session_id UUID REFERENCES playback_sessions(id) ON DELETE SET NULL,
    actual_start TIMESTAMPTZ,
    actual_end TIMESTAMPTZ,
    -- Confirmed screen-time inside this window, in milliseconds.
    confirmed_duration_ms BIGINT NOT NULL DEFAULT 0 CHECK (confirmed_duration_ms >= 0),
    match_evaluated_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    CHECK (expected_end IS NULL OR expected_end > expected_start)
);

CREATE INDEX expected_playback_screen_time_idx
    ON expected_playback_windows(screen_id, expected_start DESC);
CREATE INDEX expected_playback_open_idx
    ON expected_playback_windows(screen_id)
    WHERE expected_end IS NULL AND superseded_at IS NULL;
CREATE INDEX expected_playback_status_idx
    ON expected_playback_windows(match_status, expected_start DESC);
CREATE INDEX expected_playback_schedule_idx
    ON expected_playback_windows(schedule_id, expected_start DESC)
    WHERE schedule_id <> '';

-- +goose Down
DROP TABLE expected_playback_windows;
