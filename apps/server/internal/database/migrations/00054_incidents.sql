-- +goose Up

-- Activity treated the latest bad event on a screen as an unresolved issue, so
-- a screen that dropped out five times showed five problems, a screen that had
-- recovered still showed its last failure, and nothing could be acknowledged.
-- An incident is the underlying condition: it opens once, absorbs repeats, and
-- recovers when the evidence says the condition ended.

CREATE TABLE incidents (
    id UUID PRIMARY KEY,
    incident_type TEXT NOT NULL CHECK (incident_type IN ('connectivity','playback','storage','safe_mode','update')),
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','error','critical')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','recovered','resolved','ignored')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',

    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Repeats of the same condition move this forward instead of opening a
    -- second incident for one problem.
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The condition ended on its own. Distinct from resolved, which is a person
    -- saying the matter is closed.
    recovered_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,

    primary_screen_id UUID REFERENCES screens(id) ON DELETE CASCADE,
    -- Denormalised so an incident survives a screen leaving a group, and so the
    -- fleet breakdown does not need a join per row.
    location_id UUID,
    group_id UUID REFERENCES screen_groups(id) ON DELETE SET NULL,
    device_model TEXT NOT NULL DEFAULT '',
    player_version TEXT NOT NULL DEFAULT '',

    failure_code TEXT NOT NULL DEFAULT '',
    -- Only set when the evidence establishes it. An empty value means unknown,
    -- and the dashboard says so rather than inventing a likely cause.
    probable_cause TEXT NOT NULL DEFAULT '',
    recovery_event_id UUID REFERENCES player_activity_events(id) ON DELETE SET NULL,
    -- Whether the condition ended by itself or a person closed it, which is the
    -- basis of the automatic-versus-manual recovery breakdown.
    recovery_mode TEXT CHECK (recovery_mode IS NULL OR recovery_mode IN ('automatic','manual')),
    resolution_reason TEXT NOT NULL DEFAULT '',
    resolution_notes TEXT NOT NULL DEFAULT '',

    related_type TEXT NOT NULL DEFAULT '',
    related_id TEXT NOT NULL DEFAULT '',

    -- The deduplication key. One open incident per screen per condition; the
    -- partial unique index is what makes a repeat an update rather than a row.
    dedupe_key TEXT NOT NULL,
    occurrence_count BIGINT NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Active" means the condition is still believed to be happening. A recovered
-- incident stays visible until someone closes it, but no longer blocks a new
-- one from opening if the condition returns.
CREATE UNIQUE INDEX incidents_active_dedupe_idx
    ON incidents(dedupe_key)
    WHERE status IN ('open','acknowledged');
CREATE INDEX incidents_status_time_idx ON incidents(status, last_seen_at DESC);
CREATE INDEX incidents_screen_idx ON incidents(primary_screen_id, opened_at DESC);
CREATE INDEX incidents_type_idx ON incidents(incident_type, opened_at DESC);

-- Screens beyond the primary one, for a fleet-wide condition.
CREATE TABLE incident_screens (
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (incident_id, screen_id)
);

-- The evidence behind an incident: which events opened it, repeated it, and
-- recovered it. Keeping them means an incident never has to assert a cause it
-- cannot show the operator.
CREATE TABLE incident_events (
    id UUID PRIMARY KEY,
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    activity_event_id UUID REFERENCES player_activity_events(id) ON DELETE SET NULL,
    role TEXT NOT NULL CHECK (role IN ('opened','recurrence','recovered','note','action')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    summary TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX incident_events_incident_idx ON incident_events(incident_id, occurred_at DESC, id DESC);

-- +goose Down
DROP TABLE incident_events;
DROP TABLE incident_screens;
DROP INDEX IF EXISTS incidents_type_idx;
DROP INDEX IF EXISTS incidents_screen_idx;
DROP INDEX IF EXISTS incidents_status_time_idx;
DROP INDEX IF EXISTS incidents_active_dedupe_idx;
DROP TABLE incidents;
