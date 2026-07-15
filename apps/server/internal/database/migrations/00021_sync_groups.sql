-- +goose Up

-- Existing installations may have placed a screen in several groups. Keep the
-- oldest membership so the new single-group invariant can be installed safely.
WITH ranked AS (
    SELECT screen_group_id, screen_id,
           row_number() OVER (PARTITION BY screen_id ORDER BY added_at, screen_group_id) AS position
    FROM screen_group_memberships
)
DELETE FROM screen_group_memberships membership
USING ranked
WHERE membership.screen_group_id = ranked.screen_group_id
  AND membership.screen_id = ranked.screen_id
  AND ranked.position > 1;

CREATE UNIQUE INDEX screen_group_memberships_one_group_per_screen
    ON screen_group_memberships(screen_id);

ALTER TABLE screen_groups
    ADD COLUMN playback_epoch TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE screen_group_playlist_assignments (
    screen_group_id UUID PRIMARY KEY REFERENCES screen_groups(id) ON DELETE CASCADE,
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE RESTRICT,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX screen_group_playlist_assignments_playlist_idx
    ON screen_group_playlist_assignments(playlist_id);

-- Preserve one existing fallback assignment per group, preferring the oldest.
WITH ranked AS (
    SELECT membership.screen_group_id, assignment.playlist_id,
           assignment.assigned_by, assignment.assigned_at,
           row_number() OVER (
               PARTITION BY membership.screen_group_id
               ORDER BY assignment.assigned_at, assignment.screen_id
           ) AS position
    FROM screen_group_memberships membership
    JOIN screen_playlist_assignments assignment
      ON assignment.screen_id = membership.screen_id
)
INSERT INTO screen_group_playlist_assignments(
    screen_group_id, playlist_id, assigned_by, assigned_at
)
SELECT screen_group_id, playlist_id, assigned_by, assigned_at
FROM ranked
WHERE position = 1;

DELETE FROM screen_playlist_assignments assignment
USING screen_group_memberships membership
WHERE membership.screen_id = assignment.screen_id;

-- A schedule aimed at one member now applies to the whole synchronized group.
INSERT INTO schedule_targets(schedule_id, target_type, screen_group_id)
SELECT DISTINCT target.schedule_id, 'group', membership.screen_group_id
FROM schedule_targets target
JOIN screen_group_memberships membership ON membership.screen_id = target.screen_id
WHERE target.target_type = 'screen'
ON CONFLICT(schedule_id, screen_group_id) DO NOTHING;

DELETE FROM schedule_targets target
USING screen_group_memberships membership
WHERE target.target_type = 'screen'
  AND target.screen_id = membership.screen_id;

-- +goose Down

INSERT INTO screen_playlist_assignments(
    id, screen_id, playlist_id, assigned_by, assigned_at, updated_at
)
SELECT gen_random_uuid(), membership.screen_id, assignment.playlist_id,
       assignment.assigned_by, assignment.assigned_at, assignment.updated_at
FROM screen_group_memberships membership
JOIN screen_group_playlist_assignments assignment
  ON assignment.screen_group_id = membership.screen_group_id
ON CONFLICT(screen_id) DO NOTHING;

DROP TABLE screen_group_playlist_assignments;
ALTER TABLE screen_groups DROP COLUMN playback_epoch;
DROP INDEX screen_group_memberships_one_group_per_screen;
