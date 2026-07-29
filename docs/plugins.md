# Built-in plugins

Plugins are typed Tilecast features that can affect Player behavior outside normal playlist items and Layout zones. They are compiled into Tilecast, configured in Studio, and projected into each targeted screen's authenticated manifest. Tilecast does not load third-party code, download plugins, or accept arbitrary plugin manifests.

## Countdown Bar

Countdown Bar is the first built-in plugin. An installation can create multiple instances, each with its own name, message, schedule, lead time, optional completion text, display mode, height, background countdown, enabled state, priority, and targets.

Weekly instances use an IANA timezone, a wall-clock target time, and one or more days where Sunday is `0` and Saturday is `6`. One-time instances use an absolute RFC 3339 target. A bar is active from its configured lead time until the target. When completion text is configured, it remains visible for one minute after the target; otherwise the bar hides at zero. If active instances overlap, the Player shows the highest priority instance, then the earliest target, then the stable instance ID.

Targets are one of:

- all active screens;
- one or more individual screens;
- one or more sync groups; or
- one or more locations.

### Background countdown

`progressFill` controls the bar's background. `none` leaves it plain. `drain` tints the whole bar when the lead window opens and retreats the tint leftward as the target approaches, so the bar holds only its background colour at zero — the elapsed share of the lead window, read as a shrinking block rather than a number. While completion text shows, the fill stays empty.

The fill is a share of the configured lead time, not of a fixed span: a fifteen-minute lead empties over fifteen minutes and a two-minute lead over two. Players animate between the once-a-second steps, which smooths the sweep without implying a finer clock than the Player has, and honour a reduced-motion preference where the platform exposes one.

`progressFill` is optional on the wire. An omitted value is stored as `none`, and a Player released before the field existed ignores the key and draws the bar exactly as before.

Changing an instance increments the manifest revision for every screen. The next authenticated manifest contains only enabled instances that apply to that screen.

## Player behavior

The manifest carries a discriminated `plugins` array. Countdown Bar uses `type: "countdown_bar"` and `version: 1`. The complete timing rule is cached in `manifest-active.json`; recurrence is evaluated locally with the configured timezone, so a temporary server outage does not stop future show or hide transitions.

Both the Linux and Android players render the bar, and both resolve the schedule from the cached manifest with the same weekly, one-time, daylight-saving, completion, priority, and fill rules. The two implementations are covered by matching test cases so a divergence surfaces as a failure rather than as a difference between screens.

Plugin projection and presentation use a dedicated renderer channel. It does not replace the active presentation, change playlist selection, increment the renderer generation, remount media, touch synchronized-playback anchors, or open and close proof-of-play sessions. On Android the bar composes around a single playback call site for the same reason: appearing, changing mode, and hiding must not restart the media item.

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
