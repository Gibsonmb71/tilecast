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

## Manifest synchronization and playback

`GET /api/v1/player/manifest` uses the active device credential. It returns schema version 1, a persisted per-screen version, a single-zone playlist or `null`, exact compatible variants, hashes, sizes, and authenticated relative download paths. `If-None-Match` returns 304 without incrementing the version.

Playback-relevant changes send only `{ "type": "manifest.changed", "manifestVersion": 12 }` on the authenticated socket. Players also reconcile every five minutes and on connection. They save a pending manifest, resume `.part` downloads with `Range` and `If-Range`, verify size and SHA-256, and atomically promote verified files. A replacement activates at the next item boundary; failed preparation never overwrites active content.

Delivery is deterministic: Download always caches; Stream requires connectivity; Automatic downloads images and videos up to 256 MiB when cache and reserved disk space permit, otherwise it streams video. The cache limit is 8 GiB, free-space reserve is 1 GiB, and at most two downloads run concurrently.

## Scheduled playback and offline limits

Manifest schema v2 is activated atomically only after all Download-policy content for the direct fallback and included schedules is verified. Selection uses `[start, end)` intervals. The player evaluates with its device clock, wakes at the next transition, and restores the direct assignment whenever no schedule is active. Weekly schedules continue offline indefinitely while their definitions and assets remain cached. A future one-time schedule that was not received before disconnection cannot activate. Stream-policy media still requires connectivity and is not guaranteed offline.

Clock changes, timezone changes, app foregrounding, startup, manifest activation, and transition wake-ups cause reevaluation. The manifest server timestamp is used only to report approximate skew; it never silently replaces the device clock for offline scheduling.

## Website playback

Manifest v3 adds `websites` and website playlist items. Website items have no media variant and are not included in download selection. A referenced fallback image does have normal asset/variant metadata and must be verified before manifest activation. Website failures never invalidate an otherwise prepared manifest.

The player reports only website asset ID, state, timestamps, safe failure category, blocked-navigation count, origin host, fallback state, and renderer recovery count. Full URLs and query strings are excluded. Website clearing uses the general persistent command protocol.

## Emergency and command protocol

Manifest v4 may contain one active emergency with its playlist and half-open activation/expiration interval. The player prepares it atomically, interrupts normal playback when ready, and re-evaluates schedules on restoration. `commands.available` prompts authenticated retrieval; acknowledgement and safe result endpoints make delivery persistent and idempotent. Emergency takeover overrides playback-disabled state, then returns to disabled after expiration.
