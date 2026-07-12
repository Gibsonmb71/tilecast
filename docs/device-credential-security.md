# Device credential security

Every screen receives a separate random credential formatted as `tc_device_<public-id>.<secret>`. The public ID selects a database record; the 256-bit random secret is checked against its SHA-256 hash with constant-time comparison. The full credential is returned once and is never stored or logged by the server.

Android stores the credential encrypted with an AES-GCM key generated inside Android Keystore. Room contains non-secret configuration only. Revocation timestamps the credential record, closes the active WebSocket, rejects future requests with `device_credential_revoked`, and causes the player to delete its local credential.

Disable is reversible and preserves the credential. Revoke is permanent and requires pairing again. Both operations are role-restricted, CSRF-protected, and audited.
Website content does not change device authentication. Website pages never receive the Tilecast device credential, and WebView requests are not given Tilecast authorization headers. Website authentication credentials, imported cookies, OAuth tokens, and native JavaScript bridges are outside the product boundary.

The player configuration endpoint uses the same per-device boundary and returns only effective non-secret values for that screen. It never returns policy sources, environment values, connection strings, signing material, sessions, or other screens.

Update metadata and APK ranges require device authentication plus an active deployment targeting that exact screen. Commands contain identifiers, expected version/hash, mode, and expiration only—never URLs, keys, credentials, or paths. Releases come only from `Gibsonmb71/tilecast`; the server verifies the Ed25519 statement, APK checksum, Android signature, and signing certificate.
