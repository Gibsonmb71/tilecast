-- +goose Up

-- Publish approval and the Contributor role.
--
-- Approvals already exist for Forms records. The recurring ask is the other
-- half: a student club, a branch librarian, or a volunteer can build a slide,
-- but somebody checks it before it reaches a hallway. That needs a role that
-- authors content without publishing it, and a review step in front of the
-- screens.
--
-- The review is modelled as a decision about a revision, not as a submission
-- workflow. There is deliberately no "submitted" state and no submit button:
--
--   * pending review  = the content's current revision has no approval
--   * approved        = an approval row exists for exactly this revision
--
-- Editing approved content bumps its revision, so it re-enters the queue by
-- itself. A state machine with an explicit submit step would have to be kept in
-- step with every edit path, and the first path that forgot would let unreviewed
-- content onto a screen while still reading as approved.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('owner', 'administrator', 'editor', 'contributor', 'viewer'));

CREATE TABLE content_reviews (
    id uuid PRIMARY KEY,
    content_type text NOT NULL CHECK (content_type IN ('playlist', 'layout')),
    content_id uuid NOT NULL,
    -- The revision the decision was made about. For a playlist this is
    -- playlists.revision; for a Layout it is the revision number of the
    -- published layout_revisions row. A decision never applies to a revision
    -- other than the one that was actually read.
    revision bigint NOT NULL CHECK (revision > 0),
    decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    -- A rejection without a reason is not a review. Enforced in the service so
    -- the message can name the field.
    note text NOT NULL DEFAULT '',
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    -- One decision per revision. Re-reviewing the same revision replaces it,
    -- which is how a rejection is reversed without inventing a third state.
    UNIQUE (content_type, content_id, revision)
);
CREATE INDEX content_reviews_recent_idx
    ON content_reviews(content_type, content_id, revision DESC);

-- +goose Down

DROP TABLE content_reviews;
-- Accounts on the removed role would violate the narrower constraint. They
-- become viewers, which is the least-privileged option, rather than blocking
-- the rollback or silently gaining permissions.
UPDATE users SET role = 'viewer' WHERE role = 'contributor';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('owner', 'administrator', 'editor', 'viewer'));
