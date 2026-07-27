# Activity Event Contract

Version: **2**. Both the Android and the Linux Player emit this vocabulary. The server accepts version 1 names during the transition and maps them onto version 2 before deriving anything, so a fleet can be upgraded one player at a time.

Before version 2 the two players described the same conditions differently. Android reported `playlist_item.completed`; Linux reported `content.completed` with no matching start, so its playback never became a proof-of-play session at all. Linux said `connection.recovered` where Android said `connection.restored`, and `reliability.safe_mode` where Android said `safe_mode.entered`. The same outage derived a different screen-state timeline depending on the platform. The contract exists so it cannot.

## Envelope

Every event carries the same envelope. The server assigns `receivedAt`; everything else comes from the Player.

| Field               | Required | Notes                                                                                      |
| ------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `id`                | yes      | UUID. Retries reuse it, which is what makes ingestion idempotent.                          |
| `sequence`          | yes      | Positive, monotonic per device, persisted across process restarts.                         |
| `eventType`         | yes      | A name from the table below.                                                               |
| `category`          | no       | Derived from the event name when absent.                                                   |
| `severity`          | no       | `debug`, `info`, `warning`, `error`, `critical`. Derived when absent.                      |
| `result`            | no       | `playing`, `completed`, `partial`, `skipped`, `failed`, `unknown`, `recovered`, `success`. |
| `occurredAt`        | yes      | Player wall clock, RFC 3339.                                                               |
| `elapsedRealtimeMs` | no       | Monotonic clock, so a wall-clock change cannot produce a negative duration.                |
| `playerTimezone`    | no       | Defaults to `UTC`.                                                                         |
| `priority`          | no       | 0–9. Governs which events survive a full local queue.                                      |
| `metadata`          | no       | Allowlisted and sanitized on ingest.                                                       |

## Session fields

These fields are what turn an event stream into proof of play. A start event opens a session; the matching end event closes the same `activitySessionId`.

| Field                                                                                               | Applies to         | Notes                                                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `activitySessionId`                                                                                 | start and end      | Stable for the life of one session. The end event **must** repeat the start's value.           |
| `parentActivitySessionId`                                                                           | child start        | The root presentation session this content plays inside.                                       |
| `sessionType`                                                                                       | start              | `presentation`, `content`, `layout_placement`, `playlist_item`.                                |
| `terminalReason`                                                                                    | end                | See below. Required on end events in version 2.                                                |
| `expectedDurationMs`                                                                                | start, when known  | What the item was supposed to run for.                                                         |
| `durationMs`                                                                                        | end                | Measured from the monotonic clock.                                                             |
| `trigger`                                                                                           | start              | `schedule`, `direct`, `emergency`, `manual`.                                                   |
| `presentationId` / `presentationType` / `presentationRevision`                                      | both               | Identifies the playlist or layout.                                                             |
| `contentId` / `contentType`                                                                         | child              | Identifies the media, Widget, or website.                                                      |
| `playlistItemId`                                                                                    | child              | Position within a playlist.                                                                    |
| `layoutPlacementId`                                                                                 | child              | Zone within a layout.                                                                          |
| `scheduleId`                                                                                        | both               | The schedule that selected this presentation.                                                  |
| `emergencyId`                                                                                       | both               | The emergency takeover in force.                                                               |
| `manifestVersion`                                                                                   | both               | The manifest the Player was running.                                                           |
| `sourceId`, `selectedRecordId`, `selectionDate`, `sourceCachedAt`, `sourceRevision`, `snapshotHash` | date-aware Widgets | Data-source attribution. Raw field values and private payloads are never copied into Activity. |

### Session types

- `presentation` — the root interval. This is the screen's wall clock, and only these intervals are unioned into confirmed screen playback time.
- `content` — a media item, Widget, or website playing inside a presentation.
- `layout_placement` — content bound to one zone of a layout. Several may run at once.
- `playlist_item` — one position in a playlist.

Child intervals are summed into content exposure, which may legitimately exceed wall clock. They are never added to screen playback time.

### Terminal reasons

| Reason                     | Expected ending | Meaning                                                       |
| -------------------------- | --------------- | ------------------------------------------------------------- |
| `expected_item_boundary`   | yes             | The item ran to the end of its slot and the next one started. |
| `completed_duration`       | yes             | The item played for its full expected duration.               |
| `schedule_transition`      | yes             | A schedule became active or ended.                            |
| `manifest_replacement`     | yes             | New content was published and activated.                      |
| `direct_assignment_change` | yes             | An operator changed the direct assignment.                    |
| `emergency_takeover`       | yes             | An emergency replaced normal playback.                        |
| `manual_skip`              | yes             | An operator or command skipped the item.                      |
| `player_restart`           | no              | The Player process restarted.                                 |
| `process_exit`             | no              | The process exited without a restart.                         |
| `heartbeat_gap`            | no              | The Player stopped reporting.                                 |
| `renderer_failure`         | no              | The renderer failed.                                          |
| `decoder_failure`          | no              | Media decoding failed.                                        |
| `recovery_action`          | no              | Self-heal interrupted playback to recover it.                 |
| `bounded_timeout`          | no              | The server closed a session left open past its bound.         |
| `unknown`                  | neither         | No evidence. Not counted as an interruption.                  |

"Interrupted plays" counts sessions whose terminal reason is in the _no_ column. A scheduled changeover, an emergency, and a normal item boundary all end playback early and are exactly what was asked for, so they are excluded. `unknown` is excluded too: absence of evidence is not evidence of an interruption, and counting it would classify every pre-version-2 record as a fault.

## Event vocabulary

Both players emit the version 2 name. The version 1 column is what the server still accepts.

| Version 2 name           | Category       | Default severity | Default result | Session boundary      | Version 1 aliases accepted                                                                                      |
| ------------------------ | -------------- | ---------------- | -------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `presentation.started`   | `manifest`     | info             | playing        | starts `presentation` | `presentation.activated`, `playlist.started`, `layout.activated`                                                |
| `presentation.stopped`   | `manifest`     | info             | partial        | ends `presentation`   | `presentation.completed`                                                                                        |
| `presentation.failed`    | `manifest`     | error            | failed         | ends `presentation`   | —                                                                                                               |
| `presentation.recovered` | `manifest`     | warning          | recovered      | ends `presentation`   | —                                                                                                               |
| `content.started`        | `playback`     | info             | playing        | starts child          | `playlist_item.started`, `media.started`, `widget.started`, `layout_zone_item.started`, `data_widget.activated` |
| `content.completed`      | `playback`     | info             | completed      | ends child            | `playlist_item.completed`, `media.completed`, `widget.completed`                                                |
| `content.failed`         | `playback`     | error            | failed         | ends child            | `playlist_item.failed`, `media.failed`, `widget.failed`                                                         |
| `content.skipped`        | `playback`     | info             | skipped        | ends child            | `playlist_item.skipped`                                                                                         |
| `connection.lost`        | `connectivity` | warning          | unknown        | —                     | —                                                                                                               |
| `connection.restored`    | `connectivity` | info             | recovered      | —                     | `connection.recovered`                                                                                          |
| `heartbeat.gap_detected` | `connectivity` | warning          | unknown        | closes open sessions  | —                                                                                                               |
| `renderer.failure`       | `playback`     | error            | failed         | —                     | —                                                                                                               |
| `renderer.recovered`     | `playback`     | warning          | recovered      | —                     | —                                                                                                               |
| `decoder.failure`        | `playback`     | error            | failed         | —                     | —                                                                                                               |
| `safe_mode.entered`      | `reliability`  | error            | failed         | —                     | `reliability.safe_mode`                                                                                         |
| `safe_mode.exited`       | `reliability`  | info             | recovered      | —                     | —                                                                                                               |
| `self_heal.attempted`    | `reliability`  | warning          | unknown        | —                     | `reliability.self_heal`                                                                                         |
| `self_heal.succeeded`    | `reliability`  | info             | recovered      | —                     | —                                                                                                               |
| `storage.pressure`       | `reliability`  | warning          | failed         | —                     | —                                                                                                               |
| `manifest.activated`     | `manifest`     | info             | success        | —                     | —                                                                                                               |
| `schedule.became_active` | `scheduling`   | info             | success        | —                     | —                                                                                                               |
| `schedule.ended`         | `scheduling`   | info             | success        | —                     | —                                                                                                               |
| `emergency.active`       | `emergencies`  | critical         | playing        | —                     | —                                                                                                               |
| `emergency.restored`     | `emergencies`  | info             | recovered      | —                     | —                                                                                                               |
| `update.*`               | `updates`      | varies           | varies         | —                     | —                                                                                                               |
| `command.*`              | `commands`     | varies           | varies         | —                     | —                                                                                                               |

## Obligations on both players

- Start a root `presentation` session whenever content begins playing, and end it when it stops.
- Start a child session per media item, Widget, or layout placement, and end it with the same `activitySessionId`.
- Report `expectedDurationMs` when the item has a known duration.
- Report a `terminalReason` on every end event.
- Use idempotent event IDs and a sequence persisted across restarts.
- Keep unsent events buffered through short outages and retry them.
- Report measurements, not conclusions, to the telemetry endpoint. A player says "round-trip was 2400ms"; the server decides whether that is an incident.
- Report render progress honestly: a renderer liveness probe is not evidence that anything is on screen, and must not be sent as a progress signal. See [meaningful render progress](activity.md#meaningful-render-progress).

A terminal event with no matching start is still accepted, and the server synthesizes a session from the reported duration so the playback is not lost. That path exists only for the transition; it cannot recover a start time the Player never sent, so it is not a substitute for opening the session.

## Versioning and compatibility

The contract version is a property of this document, not a field on the wire. Version 1 events remain acceptable when they use the enumerated legacy fields: unrelated unknown fields are rejected by strict JSON decoding, absent `sessionType` and `terminalReason` are derived from the event name and identifiers, and every version 1 name in the table above resolves to its version 2 equivalent before derivation.

Two consequences follow, and both are deliberate:

- A version 1 event's derived `terminalReason` is often `unknown`, so its session is not counted as an interruption. Under-reporting an interruption is safer than inventing one.
- The reported `eventType` is stored verbatim. The Screen Events report shows exactly what the Player said; only derivation uses the canonical name.

Version 1 support is removed only once no supported Player emits it. Fixtures for both versions live in `packages/api-schema/activity/contract-v2-fixtures.json` and are consumed by the Go, Kotlin, and TypeScript test suites, so a change to the contract fails all three at once.
