-- +goose Up

-- Integration tokens. A school's lunch menu, sports scores, and bell changes
-- already live in another system, and today somebody retypes them into
-- Tilecast. A token lets that system write into a Manual Table Data Source, and
-- lets existing monitoring read fleet health, without anybody sharing a Studio
-- password or a device credential.
--
-- The capability set is closed and small, in the same spirit as the fixed
-- player command set: there is no token scope that reaches arbitrary
-- administration, no scope that can create or delete content, and no scope that
-- can touch screens.

CREATE TABLE integration_tokens (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization_settings(id),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),

    -- Same shape as a device credential: a public id selects the row, and the
    -- random secret is compared against its hash in constant time. The secret
    -- itself is never stored, so a database or backup disclosure cannot be
    -- turned into a working token.
    public_id text NOT NULL UNIQUE,
    secret_hash bytea NOT NULL,

    scopes text[] NOT NULL CHECK (
        cardinality(scopes) > 0
        AND scopes <@ ARRAY['data_source:write', 'activity:read']::text[]),

    -- Empty means every Manual Table source. Naming sources narrows a write
    -- token to exactly the ones an integration should touch.
    data_source_ids uuid[] NOT NULL DEFAULT '{}',

    -- The account that created the token is the actor recorded for anything the
    -- token does, so a change is always attributable to a person as well as to
    -- an integration. Deleting that account stops the token working, which is
    -- deliberate: a token must not outlive everyone who knows why it exists.
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz
);
CREATE INDEX integration_tokens_active_idx ON integration_tokens(created_at DESC)
    WHERE revoked_at IS NULL;

-- +goose Down

DROP TABLE integration_tokens;
