# Quick Present

Quick Present is Tilecast's temporary **Show now** action. It is intentionally
separate from Emergency Takeovers: a Quick Present session is a low-priority
temporary override and does not capture or restore a playback snapshot.

## Priority

Players resolve presentations in this order:

1. Emergency Takeover
2. External presentation, including the existing AirPlay runtime
3. Quick Present
4. The active scheduled or assigned presentation
5. The outside-hours state

Starting Quick Present on a destination with an active AirPlay session returns
a conflict. Tilecast does not stop or redesign AirPlay. If an external
presentation starts after Quick Present, the external presentation remains in
control and the Quick Present override remains durable for evaluation when it
ends.

## Destinations and content

The destination can be one screen or one Display Group. A Mirror group receives
the same temporary presentation and keeps its normal synchronized playback
epoch. Span-group projection is added by the video-wall stack; it uses the same
durable override record and logical-canvas manifest contract.

Studio can present a published playlist, published Layout, ready library image
or video, or a ready Widget/website asset. The server projects a direct media
asset as a deterministic one-item playlist so Players do not need a second
content protocol or local transcoding path.

Supported durations are 5, 15, 30, or 60 minutes, or **Until stopped**. The
post-session action is currently fixed to **Resume normal content**.

## Durability and expiry

`presentation_overrides` is persisted in PostgreSQL. Creating or stopping a
session advances every affected screen's manifest version and sends the normal
manifest-change notification. Players also evaluate the start and expiration
timestamps locally, so a reconnect or server restart does not lose the
session.

When a session expires, Tilecast reevaluates the current Emergency Takeover,
external presentation, schedule, assignment, active-hours policy, and content
availability. It never restores a stale saved playback snapshot. A session
with `wakeDisplay: true` records an explicit wake request; Display Control may
honor it only when the target Player reports a power capability and the
operator has enabled the behavior. Quick Present never silently powers on an
unsupported display.

The dashboard routes are:

- `GET /api/v1/presentation-overrides`
- `POST /api/v1/presentation-overrides`
- `POST /api/v1/presentation-overrides/{id}/stop`

Mutations require the normal dashboard session, role, and CSRF protections.
