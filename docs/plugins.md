# Built-in plugins

Plugins are typed, built-in Tilecast features that add bounded workflows or affect Player behavior outside normal playlist items and Layout zones. They are compiled into Tilecast and configured in Studio. Player-facing plugins are projected into each targeted screen's authenticated manifest; workflow plugins need not add manifest entries of their own. Tilecast does not load third-party code, download plugins, or accept arbitrary plugin manifests.

## Forms

Forms collects submissions, applies review and approval workflows, and exposes approved records to Widgets and Layout bindings. Operators create and manage forms at **Plugins → Forms**. Submitters continue to use **My Forms**, and reviewers may use the central Approvals inbox.

Forms remains a typed Data Source provider in the internal content contract because its approved records are reusable signage data. That implementation detail does not make a form an external data connection: Studio omits Forms from the Data Sources library and creation gallery, and legacy `/data-sources/...` form links redirect to the canonical `/plugins/forms/...` routes.

Forms does not add a Player plugin manifest entry. Its published views flow through the ordinary authenticated Data Source projection used by Widgets and Layout bindings.

## Countdown Bar

Countdown Bar was the first built-in plugin. An installation can create multiple instances, each with its own name, message, schedule, lead time, optional completion text and confetti, display mode, height, horizontal padding, text size, background countdown, enabled state, priority, and targets.

Weekly instances use an IANA timezone, a wall-clock target time, and one or more days where Sunday is `0` and Saturday is `6`. One-time instances use an absolute RFC 3339 target. A bar is active from its configured lead time until the target. When completion text is configured, it replaces the countdown message and value for one minute after the target; otherwise the bar hides at zero. Optional confetti falls from the top for several seconds when the selected countdown reaches zero, independently of whether completion text keeps the bar visible. Reduced-motion settings suppress the effect where the platform exposes that preference. If active instances overlap, the Player shows the highest priority instance, then the earliest target, then the stable instance ID.

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

The catalog reports the plugin as enabled when monitoring is on — a monitor switched on with no rule yet is a half-finished setup, not a disabled plugin — and its instance count is the number of alert rules.

### Response mode

A rule answers a matching alert in one of two ways, chosen per rule as `responseMode`.

`takeover` raises an ordinary Takeover through the existing bounded playback-override machinery, so Player behavior is exactly Takeover behavior. It shows either Tilecast's live fullscreen alert or a custom playlist, and normal playback is restored when the alert clears.

`ticker` leaves playback running and delivers the alert as a bar along the bottom of the screen, through the same manifest `plugins` channel and the same `overlay`/`push` geometry as Countdown Bar. It raises no Takeover, owns no managed Data Source, Widget, or playlist, and has nothing to restore: the bar is gone once the screens hold a manifest without it. `tickerDisplayMode`, `tickerHeightPx`, and `tickerSpeed` (`slow`, `medium`, or `fast`) give the bar its shape. A ticker always shows the live alert; asking for a ticker and a custom playlist together is rejected rather than resolved in one direction, because a playlist is fullscreen content by nature.

Both responses use the same matching, the same `maximumDurationMinutes` ceiling, and the same targets. Changing a rule's response mode clears its live activations so the next poll answers the same alert in the new form.

Its configuration endpoints predate the plugin catalog and are unchanged, under `/api/v1/alerts/nws/`. See [takeover-and-operations.md](takeover-and-operations.md) for the monitor, rule matching, and poll health.

## Brand Bug / Watermark

Brand Bug places a persistent mark — a logo, sponsor mark, legal notice, campaign badge, or location label — in one corner over all normal content. An installation can create multiple instances, each with its own name, corner, optional logo image, optional text, size, opacity, margin, text color, backing, optional date window, enabled state, priority, and targets.

An instance needs a logo, text, or both; a mark with neither would hold a corner invisibly and is rejected. The logo comes from the Media library and must be a ready image; it is projected into the manifest as an ordinary asset, so the Player verifies, caches, and redraws it exactly like playlist media.

Sizes are expressed against the screen rather than in pixels, so one instance reads the same on a 1080p panel and a 4K one:

- logo width is 2–40 percent of screen width;
- text size is 1–12 percent of screen height;
- the corner margin is 0–20 percent of the screen's shorter edge;
- opacity is 10–100 percent.

`startsAt` and `endsAt` are both optional. An unset bound is open-ended, so a permanent logo carries neither and a campaign badge carries one or both. The window is evaluated locally against the corrected clock, the same way Countdown Bar evaluates recurrence.

At most one mark occupies a corner: the highest priority wins, then the stable instance ID. Marks in different corners appear together, so a logo can hold the top right while a legal notice holds the bottom left. Targets use the same four scopes as Countdown Bar.

## Player behavior

The manifest carries a discriminated `plugins` array. Countdown Bar uses `type: "countdown_bar"`, an Emergency Alerts ticker uses `type: "alert_ticker"`, and Brand Bug uses `type: "brand_bug"`, all at `version: 1`; a Player ignores a type it does not implement. The complete timing rule is cached in `manifest-active.json`; recurrence and date windows are evaluated locally with the configured timezone, so a temporary server outage does not stop future show or hide transitions.

Both the Linux and Android players render the bar, and both resolve the schedule from the cached manifest with the same weekly, one-time, daylight-saving, completion, priority, and fill rules. The two implementations are covered by matching test cases so a divergence surfaces as a failure rather than as a difference between screens.

### One bar slot

The two plugins share one bar slot, and an active alert ticker takes it: a bar counting down to lunch must never be what a screen is showing instead of a tornado warning. The countdown is not lost — it returns as soon as the alert clears, without touching playback either way.

An alert ticker carries the alert text and an `expiresAt` rather than a schedule. The server publishes the ticker only while it is answering an alert and withdraws it by revising the manifest, but a Player on a cached manifest has no poller to hear from: it takes the bar down itself at the expiry, using its own corrected clock. An unreadable or passed expiry hides the bar, so the surface fails toward showing nothing rather than toward presenting a stale alert as current. Because the message is longer than a bar is wide, it scrolls at the configured speed while the severity stays fixed at the leading edge; where the platform exposes a reduced-motion preference, the message is clipped instead of scrolled.

Plugin projection and presentation use a dedicated renderer channel. It does not replace the active presentation, change playlist selection, increment the renderer generation, remount media, touch synchronized-playback anchors, or open and close proof-of-play sessions. On Android the bar composes around a single playback call site for the same reason: appearing, changing mode, and hiding must not restart the media item.

Overlay mode positions the bar above the current content at the bottom of the screen. Push mode changes only the content stage's bottom inset. Existing image, video, website, Widget, and Layout nodes remain mounted and are resized inside the remaining stage, preserving their normal fit or aspect-ratio behavior.

Brand Bug always overlays and never reflows the content stage. Its corner elements are created once and updated in place, so a mark does not re-decode its logo on the one-second plugin tick. When a Countdown Bar is visible, bottom-corner marks are lifted by the bar's height rather than being covered by it. A Brand Bug logo is a required download: the manifest does not activate until the image is verified, so the mark keeps drawing while the network is gone.

A logo that becomes unavailable between saving an instance and building a manifest degrades to that instance's text; if the instance had no text, the mark is omitted from the manifest instead of publishing an empty corner. Neither case fails the manifest.

Brand Bug is drawn by Linux Player only. Android Player ignores plugin types it does not implement, so a configured mark is inert there rather than an error; drawing it on Android is outstanding work.

The Player estimates server clock offset when a manifest is received. The cached offset is reconstructed from the manifest's `serverTime` and local `storedAt`, so offline restarts retain the last known correction instead of treating the old server timestamp as the current time.

## API

Dashboard reads require a valid Tilecast session. Mutations additionally require Owner or Administrator, the session CSRF token, strict JSON, and normal request-size limits.

- `GET /api/v1/plugins` — the catalog, one entry per built-in plugin
- `GET /api/v1/plugins/countdown-bar/instances`
- `GET /api/v1/plugins/countdown-bar/instances/{id}`
- `POST /api/v1/plugins/countdown-bar/instances`
- `PUT /api/v1/plugins/countdown-bar/instances/{id}`
- `DELETE /api/v1/plugins/countdown-bar/instances/{id}`
- `GET /api/v1/plugins/brand-bug/instances`
- `GET /api/v1/plugins/brand-bug/instances/{id}`
- `POST /api/v1/plugins/brand-bug/instances`
- `PUT /api/v1/plugins/brand-bug/instances/{id}`
- `DELETE /api/v1/plugins/brand-bug/instances/{id}`

All successful JSON responses use the standard `{ "data": ... }` envelope.
