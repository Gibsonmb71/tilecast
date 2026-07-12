# Emergency takeover and player operations

Emergency takeover is an explicit, temporary fullscreen override. It is not a priority-1000 schedule. Resolution is active emergency, normal schedule, direct fallback, then no content. Activation requires a ready non-empty playlist, at least one screen or group target, and an expiration no more than `TILECAST_MAX_EMERGENCY_DURATION_HOURS` (24 by default). Overlapping screens move to the newly activated takeover; unaffected screens remain on the older takeover.

The server stores per-screen preparation and activation state and increments only affected manifests. Manifest v4 carries the emergency ID, playlist ID, activation instant, and expiration instant. The player verifies Download-policy assets before atomic activation. Working playback remains visible if preparation fails. A received emergency continues offline until its half-open expiration `[activatedAt, expiresAt)`; then the player evaluates the current normal schedule instead of resuming stale content. An offline player that never received the takeover cannot display it, and a badly incorrect device clock can affect offline expiration.

## Persistent commands

Operational commands are persisted per screen, expire, and are retrieved through device-authenticated endpoints after a lightweight `commands.available` WebSocket notification. Commands are acknowledged before execution and report a safe result. Idempotency keys and player-side completed-command storage prevent duplicate execution after reconnect or restart. Completed commands are retained for 30 days by default.

Supported commands are `sync_now`, `reload_playback`, `identify_screen`, `clear_media_cache`, `clear_website_data`, `disable_playback`, and `enable_playback`. Payloads are type-specific; only identify accepts `durationSeconds` (10–120 by default). There is no arbitrary command, URL, or executable payload.

Cache clearing preserves content protected by the active or pending manifest. Playback disable leaves pairing and networking active. An emergency overrides the ordinary disabled screen; after expiration the player returns to disabled until an enable command succeeds.

Owners and Administrators may activate or cancel emergencies and send commands. Editors and Viewers have read-only operational visibility. Administrative mutations require CSRF protection.
