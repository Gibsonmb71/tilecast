-- +goose Up

-- Multi-factor authentication for dashboard accounts.
--
-- Three factor types share one enrollment model:
--
--   1. TOTP  — a shared secret. It is necessarily recoverable, so it is the
--      only credential in this schema that is not stored as a hash. Anyone
--      with database or backup access can mint codes for an enrolled user.
--   2. Passkey — a WebAuthn credential record. Only the public key is stored,
--      so database access does not let an attacker authenticate.
--   3. Recovery code — single-use, Argon2id-hashed like a password.
--
-- Enrollment state lives here rather than on users so that an account with no
-- factors costs no rows, and so that clearing a user's factors is a delete.

CREATE TABLE user_totp_factors (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret BYTEA NOT NULL,
    -- NULL until the user proves possession by entering a code. Unconfirmed
    -- enrollments never satisfy a challenge and are replaced on re-enrollment.
    confirmed_at TIMESTAMPTZ,
    -- The last accepted time step. A code is refused when it is not strictly
    -- newer, which prevents replay inside the verification window.
    last_used_step BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_passkeys (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL UNIQUE,
    -- The go-webauthn credential record, including the public key, sign
    -- count, and attestation data needed for later verification.
    credential JSONB NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX user_passkeys_user_id_idx ON user_passkeys(user_id);

CREATE TABLE user_recovery_codes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_recovery_codes_user_id_idx ON user_recovery_codes(user_id);

-- A WebAuthn user handle must be stable, opaque, and unrelated to any other
-- identifier. It is generated on first passkey enrollment, never reused, and
-- never reissued while credentials exist.
ALTER TABLE users ADD COLUMN webauthn_handle BYTEA UNIQUE;

-- A password that was correct but has not yet been joined by a second factor
-- produces a challenge, not a session. The token is stored only as a SHA-256
-- hash, exactly like a session token, and is single-use.
CREATE TABLE mfa_challenges (
    id UUID PRIMARY KEY,
    -- NULL for a discoverable passkey login, where the user is not known
    -- until the authenticator responds.
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'passkey_login', 'passkey_registration')),
    -- WebAuthn ceremony state for passkey purposes; NULL for a code challenge.
    webauthn_session JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mfa_challenges_expires_at_idx ON mfa_challenges(expires_at);

-- A session created before a policy-required enrollment is complete may reach
-- only the enrollment endpoints. The flag is cleared in place once the user
-- enrolls, so the user is not signed out mid-enrollment.
ALTER TABLE sessions ADD COLUMN enrollment_pending BOOLEAN NOT NULL DEFAULT FALSE;

-- Records which factor satisfied the sign-in, for the audit trail and so the
-- UI can tell the user how they are currently authenticated.
ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password';

-- +goose Down

ALTER TABLE sessions DROP COLUMN auth_method;
ALTER TABLE sessions DROP COLUMN enrollment_pending;
DROP TABLE mfa_challenges;
ALTER TABLE users DROP COLUMN webauthn_handle;
DROP TABLE user_recovery_codes;
DROP TABLE user_passkeys;
DROP TABLE user_totp_factors;
