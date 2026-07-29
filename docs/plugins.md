# Built-in plugins

Plugins are typed, built-in Tilecast features that add bounded workflows or affect Player behavior outside normal playlist items and Layout zones. They are compiled into Tilecast and configured in Studio. Player-facing plugins are projected into each targeted screen's authenticated manifest; workflow plugins need not add manifest entries of their own. Tilecast does not load third-party code, download plugins, or accept arbitrary plugin manifests.

## Forms

Forms collects submissions, applies review and approval workflows, and exposes approved records to Widgets and Layout bindings. Operators create and manage forms at **Plugins → Forms**. Submitters continue to use **My Forms**, and reviewers may use the central Approvals inbox.

Forms remains a typed Data Source provider in the internal content contract because its approved records are reusable signage data. That implementation detail does not make a form an external data connection: Studio omits Forms from the Data Sources library and creation gallery, and legacy `/data-sources/...` form links redirect to the canonical `/plugins/forms/...` routes.

Forms does not add a Player plugin manifest entry. Its published views flow through the ordinary authenticated Data Source projection used by Widgets and Layout bindings.

## Countdown Bar

Countdown Bar was the first built-in plugin. An installation can create multiple instances, each with its own name, message, schedule, lead time, optional completion text, display mode, height, horizontal padding, text size, background countdown, enabled state, priority, and targets.

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

### Text fit

`contentPadding` is the percentage of the bar width reserved on both the left and right. It defaults to `4`; lowering it toward `0` lets text use more of the bar. `textScale` multiplies the height-derived type size and defaults to `100`. Studio accepts padding from 0–40 percent and text size from 25–500 percent. Players clamp both values defensively, and older manifests that omit them retain the original appearance.

Changing an instance increments the manifest revision for every screen. The next authenticated manifest contains only enabled instances that apply to that screen.

## Emergency Alerts

Emergency Alerts watches official National Weather Service alerts and takes matching screens over automatically while one is active. It is a plugin rather than an organization default: an installation opts into monitoring, and the alert rules are its instances. Settings keeps only the defaults for a Takeover a person starts by hand and for player commands.

Unlike Countdown Bar, it projects nothing into the manifest of its own. A matching alert raises an ordinary Takeover through the existing bounded playback-override machinery, so Player behavior is exactly Takeover behavior. The catalog reports the plugin as enabled when monitoring is on — a monitor switched on with no rule yet is a half-finished setup, not a disabled plugin — and its instance count is the number of alert rules.

Its configuration endpoints predate the plugin catalog and are unchanged, under `/api/v1/alerts/nws/`. See [takeover-and-operations.md](takeover-and-operations.md) for the monitor, rule matching, and poll health.

## Player behavior

The manifest carries a discriminated `plugins` array. Countdown Bar uses `type: "countdown_bar"` and `version: 1`. The complete timing rule is cached in `manifest-active.json`; recurrence is evaluated locally with the configured timezone, so a temporary server outage does not stop future show or hide transitions.

Both the Linux and Android players render the bar, and both resolve the schedule from the cached manifest with the same weekly, one-time, daylight-saving, completion, priority, and fill rules. The two implementations are covered by matching test cases so a divergence surfaces as a failure rather than as a difference between screens.

Plugin projection and presentation use a dedicated renderer channel. It does not replace the active presentation, change playlist selection, increment the renderer generation, remount media, touch synchronized-playback anchors, or open and close proof-of-play sessions. On Android the bar composes around a single playback call site for the same reason: appearing, changing mode, and hiding must not restart the media item.

Overlay mode positions the bar above the current content at the bottom of the screen. Push mode changes only the content stage's bottom inset. Existing image, video, website, Widget, and Layout nodes remain mounted and are resized inside the remaining stage, preserving their normal fit or aspect-ratio behavior.

The Player estimates server clock offset when a manifest is received. The cached offset is reconstructed from the manifest's `serverTime` and local `storedAt`, so offline restarts retain the last known correction instead of treating the old server timestamp as the current time.

## API

Dashboard reads require a valid Tilecast session. Mutations additionally require Owner or Administrator, the session CSRF token, strict JSON, and normal request-size limits.

- `GET /api/v1/plugins` — the catalog, one entry per built-in plugin
- `GET /api/v1/plugins/countdown-bar/instances`
- `GET /api/v1/plugins/countdown-bar/instances/{id}`
- `POST /api/v1/plugins/countdown-bar/instances`
- `PUT /api/v1/plugins/countdown-bar/instances/{id}`
- `DELETE /api/v1/plugins/countdown-bar/instances/{id}`

All successful JSON responses use the standard `{ "data": ... }` envelope.
