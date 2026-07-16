# Activity

Tilecast Activity is divided into four reporting domains. They intentionally use separate storage and APIs so an assigned schedule is never mistaken for proof that content actually appeared on a screen.

| Domain        | Question answered                                                       | Source                                                            |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Overview      | What needs attention across this installation?                          | Derived from the other Activity domains                           |
| Proof of Play | What did a Player confirm was displayed, where, when, and for how long? | `playback_sessions` derived from Player events                    |
| Screen Events | What did a Player or the server do?                                     | Append-only `player_activity_events` and `screen_state_intervals` |
| Audit Log     | What did an authenticated user or administrator change?                 | `audit_logs`                                                      |

## Player event ingestion

Paired Players upload bounded batches to `POST /api/v1/player/activity-events` with their existing device credential. The server always obtains the screen identity from that credential and ignores any screen identity supplied by a client payload.

Every Player event has a UUID and a per-screen sequence. UUID and sequence constraints make retries idempotent. The Player persists its queue in app-private storage, increments the sequence across process restarts, retries in batches of at most 100, and removes events only after the server acknowledges their IDs. Queue writes and uploads run off the playback thread. When the local cap is reached, the oldest low-priority routine events are removed before failures, recovery events, or presentation boundaries.

`occurredAt` is the Player wall-clock timestamp. `receivedAt` is assigned by the server. Durations are measured with Android elapsed realtime so wall-clock changes cannot create negative or inflated playback intervals.

## Proof-of-play derivation

The server derives `playback_sessions` from matching start and terminal events. A session is not considered completed until the Player reports a completion. Missing terminal events become:

- `partial` when a new incompatible root presentation starts;
- `unknown` after the bounded open-session timeout or a reporting gap;
- `failed` only when the Player reports a failure;
- `recovered` only when the Player reports successful recovery.

Layouts have a root activation interval. Meaningful child sessions are recorded for media, Widgets, and playlist-zone items. Static primitives such as shapes, lines, and background colors do not create events. Persistent Widgets create one activation interval rather than periodic update events.

Date-aware Widgets report the selected cached record by Source ID, placement or Widget ID, selected record ID, selection date, cached-at timestamp or Source revision, and snapshot hash. Raw field values and private CSV payloads are not copied into Activity.

## Audit safety

Audit metadata is allowlisted for presentation. Keys associated with passwords, sessions, OAuth tokens, Player credentials, authorization headers, private CSV payloads, and full configuration documents are discarded. IP addresses, request IDs, raw failure messages, and detailed diagnostics are returned only to Owners and Administrators.

The Activity API resolves resource names for historical audit records where possible. New authentication and Activity-setting records include result, request ID, summary, and safe metadata.

## Permissions

- **Owner:** all Activity domains, sensitive details, retention settings, and CSV exports.
- **Administrator:** all operational Activity domains, sensitive details, retention settings, and CSV exports.
- **Editor:** Overview, Proof of Play, and audit entries limited to content, Playlist, Layout, and Schedule work.
- **Viewer:** read-only Overview and Proof of Play.

The API applies permissions independently of the Studio UI so future department-scoped access can add a scope predicate without changing the event model.

## Retention

Defaults and deployment hard limits:

| Data                         |  Default |   Hard limits |
| ---------------------------- | -------: | ------------: |
| Raw Player events            |  60 days |    7–365 days |
| Proof-of-play sessions       | 365 days | 30–2,555 days |
| Screen-state intervals       | 365 days | 30–2,555 days |
| Audit logs                   | 730 days | 90–3,650 days |
| Detailed diagnostic metadata |  30 days |    7–180 days |

Cleanup deletes or redacts at most 500 rows per invocation and runs outside the playback request path. Derived sessions retain the evidence needed for reporting after their source raw events age out.

## API summary

See [`activity-api.yaml`](activity-api.yaml) for request and response shapes.

- `POST /api/v1/player/activity-events`
- `GET /api/v1/activity/overview`
- `GET /api/v1/activity/proof-of-play`
- `GET /api/v1/activity/proof-of-play/summary`
- `GET /api/v1/activity/proof-of-play/export.csv`
- `GET /api/v1/activity/screen-events`
- `GET /api/v1/activity/audit`
- `GET /api/v1/activity/audit/export.csv`
- `GET /api/v1/activity/screens/{screenId}`
- `GET|PATCH /api/v1/activity/retention`

Large event lists use a stable `(timestamp, UUID)` cursor. CSV exports are bounded and require Owner or Administrator access.
