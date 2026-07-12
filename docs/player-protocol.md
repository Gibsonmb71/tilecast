# Player pairing and connection protocol

The bootstrap identity endpoint is public and returns only the product identifier, permanent installation ID, organization name, API version, and whether pairing is enabled. A configured player verifies the installation ID before sending any stored device credential.

## Pairing

1. The player reads `GET /api/v1/system/identity`.
2. It creates a pairing session with device metadata and the expected installation ID.
3. The server returns a six-character visible code, a separate private poll secret, an expiry, and an approval URL.
4. An authenticated Owner or Administrator resolves the visible code, reviews the metadata, and approves or rejects it.
5. The player polls with `Authorization: Pairing <poll-secret>`. The visible code cannot poll.
6. The first approved poll atomically marks the session claimed and returns a one-time enrollment token.
7. The player exchanges that token once. The server creates `tc_device_<public-id>.<secret>`, stores only the secret hash, clears the enrollment-token hash, and returns the credential once.
8. The player stores the credential with Android Keystore and removes all temporary pairing secrets.

Pairing sessions expire after ten minutes. Codes use an unambiguous alphabet and are compared through indexed SHA-256 hashes. Expired records are marked during pairing activity and may be removed by later maintenance.

## Authenticated connection

Player endpoints accept `Authorization: Bearer <device-credential>`. Dashboard cookies are never accepted. `/api/v1/player/socket` uses protocol version 1 and supports `player.hello`, `player.status`, `server.ping`, and `player.pong`. `/api/v1/player/heartbeat` is the lower-frequency fallback.

Status thresholds are centralized on the server: connected socket is `online`, contact within two minutes is `recent`, contact within fifteen minutes is `stale`, and older contact is `offline`. Administrative disable and credential revocation override those states.

The content manifest protocol remains unimplemented until Milestone 4.
