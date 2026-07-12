-- +goose Up
CREATE TABLE screen_groups (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX screen_groups_list_idx ON screen_groups(organization_id, lower(name), id) WHERE deleted_at IS NULL;

CREATE TABLE screen_group_memberships (
    screen_group_id UUID NOT NULL REFERENCES screen_groups(id) ON DELETE CASCADE,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(screen_group_id, screen_id)
);
CREATE INDEX screen_group_memberships_screen_idx ON screen_group_memberships(screen_id, screen_group_id);

CREATE TABLE schedules (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK(type IN ('one_time','weekly')),
    timezone TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN -999 AND 999),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    start_date DATE,
    end_date DATE,
    one_time_start TIMESTAMPTZ,
    one_time_end TIMESTAMPTZ,
    daily_start TIME,
    daily_end TIME,
    days_of_week SMALLINT[] NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CHECK(end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
    CHECK((type='one_time' AND one_time_start IS NOT NULL AND one_time_end IS NOT NULL AND one_time_end > one_time_start AND daily_start IS NULL AND daily_end IS NULL)
       OR (type='weekly' AND one_time_start IS NULL AND one_time_end IS NULL AND daily_start IS NOT NULL AND daily_end IS NOT NULL AND cardinality(days_of_week)>0))
);
CREATE INDEX schedules_list_idx ON schedules(organization_id, updated_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX schedules_playlist_idx ON schedules(playlist_id) WHERE deleted_at IS NULL;

CREATE TABLE schedule_targets (
    schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK(target_type IN ('screen','group')),
    screen_id UUID REFERENCES screens(id) ON DELETE RESTRICT,
    screen_group_id UUID REFERENCES screen_groups(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK((target_type='screen' AND screen_id IS NOT NULL AND screen_group_id IS NULL) OR
          (target_type='group' AND screen_id IS NULL AND screen_group_id IS NOT NULL)),
    UNIQUE(schedule_id, screen_id),
    UNIQUE(schedule_id, screen_group_id)
);
CREATE INDEX schedule_targets_screen_idx ON schedule_targets(screen_id) WHERE screen_id IS NOT NULL;
CREATE INDEX schedule_targets_group_idx ON schedule_targets(screen_group_id) WHERE screen_group_id IS NOT NULL;

ALTER TABLE screen_player_status
    ADD COLUMN current_schedule_id UUID,
    ADD COLUMN current_playlist_id UUID,
    ADD COLUMN selection_source TEXT,
    ADD COLUMN next_transition_at TIMESTAMPTZ,
    ADD COLUMN device_clock_offset_seconds BIGINT,
    ADD COLUMN schedule_evaluation_error TEXT,
    ADD COLUMN schedule_manifest_version BIGINT;

-- +goose Down
ALTER TABLE screen_player_status
    DROP COLUMN schedule_manifest_version,
    DROP COLUMN schedule_evaluation_error,
    DROP COLUMN device_clock_offset_seconds,
    DROP COLUMN next_transition_at,
    DROP COLUMN selection_source,
    DROP COLUMN current_playlist_id,
    DROP COLUMN current_schedule_id;
DROP TABLE schedule_targets;
DROP TABLE schedules;
DROP TABLE screen_group_memberships;
DROP TABLE screen_groups;
