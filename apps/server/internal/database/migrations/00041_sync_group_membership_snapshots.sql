-- +goose Up

-- Joining a sync group replaces a screen's own playlist assignment and
-- screen-targeted schedules with the group's. Snapshot the originals so the
-- screen can revert to its own content when it leaves the group.
CREATE TABLE screen_group_membership_snapshots (
    screen_id UUID PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    playlist_id UUID REFERENCES playlists(id) ON DELETE SET NULL,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE screen_group_membership_schedule_snapshots (
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    PRIMARY KEY (screen_id, schedule_id)
);

-- +goose Down

DROP TABLE screen_group_membership_schedule_snapshots;
DROP TABLE screen_group_membership_snapshots;
