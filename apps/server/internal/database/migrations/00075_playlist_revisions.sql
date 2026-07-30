-- +goose Up

-- Playlist revision history.
--
-- Layouts already have this: layout_revisions plus a restore endpoint. Playlists
-- did not, and a playlist is the thing most likely to be edited in a hurry and
-- to be on every screen at once. Audit logs record that it changed; they cannot
-- put it back.
--
-- A revision row is a whole snapshot of the playlist as it was, not a diff.
-- Diffs have to be replayed to be useful, and a replay that hits a deleted asset
-- half way through leaves the playlist in a state nobody authored. A snapshot
-- restores or fails.

CREATE TABLE playlist_revisions (
    id uuid PRIMARY KEY,
    playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    -- The playlists.revision value this snapshot represents. One row per
    -- revision, so recording twice for the same edit is harmless -- which is
    -- what lets the snapshot be taken from several call sites and backfilled
    -- lazily without producing duplicates.
    revision bigint NOT NULL CHECK (revision > 0),

    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    source_type text NOT NULL DEFAULT 'static',
    tag_match text NOT NULL DEFAULT 'any',
    tag_image_duration_ms bigint NOT NULL DEFAULT 10000,
    -- The ordered items and the tag rule as they were. Asset and Layout ids are
    -- kept, not copies of the content: restoring a playlist must not resurrect
    -- media somebody deliberately deleted, and the restore says what it skipped.
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,

    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (playlist_id, revision)
);
CREATE INDEX playlist_revisions_history_idx ON playlist_revisions(playlist_id, revision DESC);

-- +goose Down

DROP TABLE playlist_revisions;
