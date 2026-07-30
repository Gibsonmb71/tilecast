-- +goose Up

-- Snapshot history. Live preview answers "what is on that screen now" and
-- forgets. Nothing answers "what was on it at 10:14", which is the question
-- asked after somebody reports that a board showed the wrong thing, or over a
-- break when nobody is in the building.
--
-- Off by default, and hard-capped in three independent ways: an interval, a
-- count per screen, and a retention period. Screen images accumulate quickly
-- and this must not be able to grow without a bound an operator chose.
--
-- Storage is BYTEA in the database, matching the existing live preview rather
-- than introducing a second image store. That has a real consequence worth
-- stating: snapshots are inside every database backup, so enabling this grows
-- backups. The caps are what keep that bounded.

CREATE TABLE screen_snapshots (
    id uuid PRIMARY KEY,
    screen_id uuid NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    -- When the Player says it rendered the frame, not when the server stored it.
    captured_at timestamptz NOT NULL,
    width integer NOT NULL DEFAULT 0 CHECK (width >= 0),
    height integer NOT NULL DEFAULT 0 CHECK (height >= 0),
    file_size integer NOT NULL DEFAULT 0 CHECK (file_size >= 0),
    content_type text NOT NULL DEFAULT '',
    image_data bytea NOT NULL,
    player_version text NOT NULL DEFAULT '',
    -- scheduled or manual. A manual capture is kept alongside the automatic
    -- ones so the history of an incident is not split across two surfaces.
    trigger text NOT NULL DEFAULT 'scheduled' CHECK (trigger IN ('scheduled', 'manual')),
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Retention and the per-screen cap both read newest-first per screen.
CREATE INDEX screen_snapshots_screen_idx ON screen_snapshots(screen_id, captured_at DESC, id DESC);
CREATE INDEX screen_snapshots_retention_idx ON screen_snapshots(captured_at);

-- +goose Down

DROP TABLE screen_snapshots;
