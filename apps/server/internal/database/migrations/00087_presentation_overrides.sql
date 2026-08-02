-- +goose Up

-- Quick Present is a durable, low-priority presentation override. It is kept
-- separate from takeovers so expiry and restart reconciliation can return to
-- the current assignment/schedule instead of restoring a stale snapshot.
CREATE TABLE presentation_overrides (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('screen','group')),
    target_id UUID NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('playlist','layout','asset')),
    content_id UUID NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 0 AND 86400),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    after_action TEXT NOT NULL DEFAULT 'resume' CHECK (after_action IN ('resume')),
    wake_display BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at TIMESTAMPTZ,
    stop_reason TEXT,
    CHECK (expires_at IS NULL OR expires_at > started_at),
    CHECK ((duration_seconds = 0 AND expires_at IS NULL) OR (duration_seconds > 0 AND expires_at IS NOT NULL))
);

CREATE INDEX presentation_overrides_active_idx
    ON presentation_overrides(organization_id, started_at DESC)
    WHERE stopped_at IS NULL;

CREATE INDEX presentation_overrides_target_idx
    ON presentation_overrides(target_type, target_id, started_at DESC);

-- +goose Down

DROP INDEX presentation_overrides_target_idx;
DROP INDEX presentation_overrides_active_idx;
DROP TABLE presentation_overrides;
