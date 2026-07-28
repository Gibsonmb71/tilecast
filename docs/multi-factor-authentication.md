# Multi-factor authentication and passkeys

Tilecast Studio accounts can carry a second factor in addition to their Argon2id password. This applies to the dashboard only. Player enrollment and device credentials are a separate authentication boundary and are unaffected; see [device-credential-security.md](device-credential-security.md).

Three factor types are supported:

| Factor                   | What it proves                                            | Stored as                                 |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------- |
| Authenticator app (TOTP) | Possession of a shared secret                             | The secret itself — recoverable by design |
| Passkey (WebAuthn)       | Possession of an authenticator plus its user verification | A public key; no secret                   |
| Recovery code            | Possession of a code issued once                          | Argon2id hash, single use                 |

A passkey signs a user in on its own, with no username and no password, and counts as multi-factor authentication because the authenticator performs user verification before it will sign. An authenticator app is a second step after the password.

## Before you enable it

**Passkeys require HTTPS and a hostname.** Browsers only run a WebAuthn ceremony in a secure context, and they reject an IP address as a relying party identifier. A Tilecast server reached at `http://192.168.1.40:8080` — the default for a signage LAN — cannot offer passkeys at all. Studio detects this at startup, hides the passkey controls, and explains why. Authenticator apps and recovery codes work everywhere.

To use passkeys, serve Tilecast over HTTPS at a hostname and set `TILECAST_PUBLIC_URL` to that address. `localhost` is exempt, because browsers treat it as a secure context, which makes local development work without certificates.

**TOTP secrets are recoverable secrets in your database.** Unlike a password or a device credential, a shared TOTP secret cannot be hashed: the server must be able to compute the same code the app shows. Anyone with database or backup access can therefore mint codes for any enrolled account. Protect database backups accordingly ([deployment.md](deployment.md)). Passkeys do not have this property — only a public key is stored — which is a reason to prefer them where the deployment can support them.

## Enabling it

Per-person enrollment is always available from **Sign-in security** in the account menu. Nothing has to be turned on organization-wide for someone to protect their own account.

To require it, an Owner or Administrator sets **Settings → Sign-in security → Require multi-factor authentication**:

- `none` — enrollment is voluntary. This is the default.
- `administrators` — Owner and Administrator accounts must enroll.
- `all` — every account must enroll.

Changing the policy signs nobody out. An account in scope that has not enrolled is admitted at its next sign-in with its session marked as owing a factor: it reaches only the enrollment screen, and the server refuses every other dashboard route with `403 mfa_enrollment_required` until a factor exists. This is deliberate — a policy change should not be able to lock the organization out of its own installation.

While a policy covers a role, the last remaining factor on such an account cannot be removed. Add the replacement first.

## Recovery

Tilecast has no email delivery, so there is no self-service reset link. Three paths exist, in order of preference:

1. **Recovery codes.** Ten single-use codes, generated from Sign-in security and shown exactly once. Regenerating invalidates every unused code.
2. **An Owner or Administrator resets the account.** Settings → Users → edit the account → **Reset** under Two-step verification. This clears the authenticator, every passkey, and all recovery codes, signs the account out everywhere, and writes an audit entry. The usual role rules apply: only an Owner may reset an Owner or Administrator.
3. **Break-glass on the server.** When the only Owner is locked out and no other administrator can help, run on the server host:

   ```sh
   tilecast mfa reset owner@example.org
   ```

   It reads the same `TILECAST_*` environment variables as the server, prompts for confirmation, and does the same thing as the Studio reset. It requires shell access and database credentials, which is a materially higher bar than a password.

After any reset the account signs in with its password alone and is asked to enroll again if a policy covers it.

## Behavior worth knowing

- **A correct password is not a session.** When an account has a factor, `POST /auth/login` returns a ten-minute single-use challenge and sets no cookie. Five wrong codes destroy the challenge.
- **Codes cannot be replayed.** An authenticator code is accepted within one time step either side of the current one to absorb clock drift, but the server records the step that was used and refuses anything that is not strictly newer. A code that was just used to confirm enrollment therefore cannot also complete a sign-in.
- **A mistyped app code never burns a recovery code.** Six digits are checked against the authenticator only; anything else is checked against recovery codes.
- **Sign count is preserved.** Each successful passkey assertion writes the updated credential record back, which is what makes authenticator clone detection possible.
- **Audit entries.** `auth.mfa.totp_enrolled`, `auth.mfa.totp_removed`, `auth.mfa.passkey_enrolled`, `auth.mfa.passkey_removed`, `auth.mfa.recovery_codes_generated`, and `auth.mfa.reset` are recorded. No secret, code, or credential appears in an audit entry.

## Configuration

| Variable                    | Default                 | Purpose                                                                               |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `TILECAST_PUBLIC_URL`       | `http://localhost:8080` | The relying party is derived from this. It must be the address browsers actually use. |
| `TILECAST_WEBAUTHN_RP_ID`   | derived                 | Override the relying party ID (a bare hostname, no scheme or port).                   |
| `TILECAST_WEBAUTHN_ORIGINS` | derived                 | Comma-separated list of permitted origins, including scheme.                          |

The two overrides are needed only behind a proxy whose external hostname differs from the one the server sees, and must be set together. The server logs the reason at startup whenever passkeys are disabled.

## Backups and restore

Factors live in the database and are included in a full backup. Restoring an archive restores the enrollments that existed when it was taken: a passkey added after the backup will no longer be recognized, and a recovery code spent after the backup becomes usable again. Treat a restore as a point in time for sign-in security as well as for content.
