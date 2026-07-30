-- +goose Up

-- Screen scopes. Roles are flat and organization-wide, so a district with four
-- buildings or a library with branches has no way to say "this person runs the
-- screens in the west wing". Everyone who can operate screens can operate all
-- of them.
--
-- This scopes screen *operations* -- assignment, takeover, commands, playback
-- enable, reliability, bulk changes -- to named locations and sync groups. The
-- content library stays organization-wide: a shared playlist is the point of a
-- shared library, and scoping content is a separate, larger decision.
--
-- The Owner is never scoped. An installation must not be able to lock itself
-- out of its own fleet, the same reason the MFA enrollment requirement is a
-- session flag rather than a login refusal.

CREATE TABLE user_screen_scopes (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_type text NOT NULL CHECK (scope_type IN ('location', 'group')),
    scope_id uuid NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scope_type, scope_id)
);
CREATE INDEX user_screen_scopes_user_idx ON user_screen_scopes(user_id);

-- No rows for an account means the whole fleet, not nothing. That direction is
-- deliberate: it is what every existing account has after this migration, so an
-- upgrade changes nobody's access. The narrowing is opt-in per account.

-- +goose Down

DROP TABLE user_screen_scopes;
