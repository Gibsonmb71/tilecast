# Takeover, NWS alerts, and player operations

Tilecast Studio keeps two operator flows distinct:

- **Takeover** is the manual “show this now” action on Screens.
- **Emergency management** configures automatic responses to matching National
  Weather Service alerts.

For automatic emergencies, operators first create a separate, non-empty
playlist for each response they may need, such as a tornado warning, flash
flood, closure, or evacuation. A weather event rule then selects one of those
pre-made playlists and its screen or group targets. The page links directly to
playlist management and back to Screens for a manual Takeover. Automatic
emergencies reuse the same bounded playback-override machinery, but Tilecast Studio does
not present a manual Takeover as an emergency rule.

Takeover is an explicit, temporary fullscreen override. It is not a priority-1000 schedule. Resolution is active Takeover, normal schedule, direct fallback, then no content. Activation requires a ready non-empty playlist, at least one screen or group target, and an expiration no more than `TILECAST_MAX_TAKEOVER_DURATION_HOURS` (24 by default). Overlapping screens move to the newly activated Takeover; unaffected screens remain on the older Takeover.

The server stores per-screen preparation and activation state and increments only affected manifests. Manifest v4 carries the Takeover ID, playlist ID, activation instant, and expiration instant. Its released JSON field remains `emergency` for wire compatibility; current server and player models expose it as Takeover. The player verifies Download-policy assets before atomic activation. Working playback remains visible if preparation fails. A received Takeover continues offline until its half-open expiration `[activatedAt, expiresAt)`; then the player evaluates the current normal schedule instead of resuming stale content. An offline player that never received the Takeover cannot display it, and a badly incorrect device clock can affect offline expiration.

## National Weather Service monitoring

Settings → Emergency management contains the NWS monitor. An Owner or Administrator selects two-letter state or territory area codes and/or six-character county or forecast-zone codes, then creates one or more rules. Each rule has exact NWS event names (or all events), minimum CAP severity and urgency, a ready playlist, explicit screen/group targets, and a duration ceiling.

The background worker requests the official active-alert GeoJSON feed using an identifying User-Agent. Area and zone scopes are fetched separately and unioned by NWS alert ID. Repeated polls update the existing `(alert, rule)` activation rather than raising duplicates. A new match raises a Takeover; the earlier of the alert's end/expiry and the rule ceiling determines expiration. When an alert is no longer active, or its rule is deleted, Tilecast cancels only the Takeover raised by that activation and restores current scheduling.

Poll time, last success, safe error code, and match count are visible in Studio. Response bodies are not logged. The integration is best-effort and must not replace Wireless Emergency Alerts, weather radios, evacuation systems, or local emergency procedures.

## Persistent commands

Operational commands are persisted per screen, expire, and are retrieved through device-authenticated endpoints after a lightweight `commands.available` WebSocket notification. Commands are acknowledged before execution and report a safe result. Idempotency keys and player-side completed-command storage prevent duplicate execution after reconnect or restart. Completed commands are retained for 30 days by default.

Supported commands are `sync_now`, `reload_playback`, `identify_screen`, `clear_media_cache`, `clear_website_data`, `disable_playback`, and `enable_playback`. Payloads are type-specific; only identify accepts `durationSeconds` (10–120 by default). There is no arbitrary command, URL, or executable payload.

Cache clearing preserves content protected by the active or pending manifest. Playback disable leaves pairing and networking active. A Takeover overrides the ordinary disabled screen; after expiration the player returns to disabled until an enable command succeeds.

Owners and Administrators may activate or cancel Takeovers, configure NWS rules, and send commands. Editors and Viewers have read-only operational visibility. Administrative mutations require CSRF protection.
