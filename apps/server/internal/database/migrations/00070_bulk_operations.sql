-- +goose Up

-- Fleet bulk operations. Content already has bulk-organize; screens had
-- nothing, so pointing forty screens at a new playlist was forty clicks and
-- one of them was wrong.
--
-- The interesting part is not the loop, it is the preview. Assigning a screen
-- that belongs to a sync group assigns the whole group, by design, so a
-- careless bulk assignment can change screens the operator never selected.
-- Recording what was replaced is what makes that survivable.

CREATE TABLE bulk_operations (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization_settings(id),
    action text NOT NULL CHECK (action IN (
        'assign_playlist', 'assign_layout', 'clear_assignment',
        'set_enabled', 'send_command')),
    -- What was asked for: playlist id, enabled flag, command type. Never a
    -- secret; a bulk operation cannot carry one.
    parameters jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(parameters) = 'object'),
    requested_by uuid REFERENCES users(id) ON DELETE SET NULL,

    screen_count integer NOT NULL DEFAULT 0 CHECK (screen_count >= 0),
    applied_count integer NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    -- Per-screen outcome, including the failure reason for anything that did
    -- not apply. An operation that half worked has to say which half.
    results jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Enough previous state to put things back, per affected screen. Only for
    -- the reversible actions: a command that has already been delivered to a
    -- Player cannot be recalled, and undo must not pretend otherwise.
    undo_state jsonb NOT NULL DEFAULT '[]'::jsonb,
    reversible boolean NOT NULL DEFAULT FALSE,
    -- Short by design. Undo exists to catch the misclick that is noticed
    -- immediately, not to be a second history mechanism -- the longer this
    -- window is, the more likely undo silently reverts somebody else's
    -- deliberate later change.
    undo_expires_at timestamptz,
    undone_at timestamptz,
    undone_by uuid REFERENCES users(id) ON DELETE SET NULL,

    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bulk_operations_recent_idx ON bulk_operations(created_at DESC, id DESC);
CREATE INDEX bulk_operations_undoable_idx ON bulk_operations(undo_expires_at)
    WHERE reversible AND undone_at IS NULL;

-- +goose Down

DROP TABLE bulk_operations;
