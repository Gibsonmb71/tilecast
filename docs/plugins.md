# Built-in plugins

Plugins are typed Tilecast features that can affect Player behavior outside normal playlist items and Layout zones. They are compiled into Tilecast, configured in Studio, and projected into each targeted screen's authenticated manifest. Tilecast does not load third-party code, download plugins, or accept arbitrary plugin manifests.

## Countdown Bar

Countdown Bar is the first built-in plugin. An installation can create multiple instances, each with its own name, message, schedule, lead time, optional completion text, display mode, height, enabled state, priority, and targets.

Weekly instances use an IANA timezone, a wall-clock target time, and one or more days where Sunday is `0` and Saturday is `6`. One-time instances use an absolute RFC 3339 target. A bar is active from its configured lead time until the target. When completion text is configured, it remains visible for one minute after the target; otherwise the bar hides at zero. If active instances overlap, the Player shows the highest priority instance, then the earliest target, then the stable instance ID.

Targets are one of:

- all active screens;
- one or more individual screens;
- one or more sync groups; or
- one or more locations.

Changing an instance increments the manifest revision for every screen. The next authenticated manifest contains only enabled instances that apply to that screen.

## Player behavior

The manifest carries a discriminated `plugins` array. Countdown Bar uses `type: "countdown_bar"` and `version: 1`. The complete timing rule is cached in `manifest-active.json`; recurrence is evaluated locally with the configured timezone, so a temporary server outage does not stop future show or hide transitions.

Plugin projection and presentation use a dedicated renderer channel. It does not replace the active presentation, change playlist selection, increment the renderer generation, remount media, touch synchronized-playback anchors, or open and close proof-of-play sessions.

Overlay mode positions the bar above the current content at the bottom of the screen. Push mode changes only the content stage's bottom inset. Existing image, video, website, Widget, and Layout nodes remain mounted and are resized inside the remaining stage, preserving their normal fit or aspect-ratio behavior.

The Player estimates server clock offset when a manifest is received. The cached offset is reconstructed from the manifest's `serverTime` and local `storedAt`, so offline restarts retain the last known correction instead of treating the old server timestamp as the current time.

## API

Dashboard reads require a valid Tilecast session. Mutations additionally require Owner or Administrator, the session CSRF token, strict JSON, and normal request-size limits.

- `GET /api/v1/plugins`
- `GET /api/v1/plugins/countdown-bar/instances`
- `GET /api/v1/plugins/countdown-bar/instances/{id}`
- `POST /api/v1/plugins/countdown-bar/instances`
- `PUT /api/v1/plugins/countdown-bar/instances/{id}`
- `DELETE /api/v1/plugins/countdown-bar/instances/{id}`

All successful JSON responses use the standard `{ "data": ... }` envelope.
