# API through Milestone 4

Milestone 1 exposes JSON endpoints under `/api/v1`. Successful responses use `{"data": ...}`. Errors use `{"error":{"code":"...","message":"..."}}`. Unknown JSON fields and request bodies over 1 MiB are rejected.

## System

- `GET /healthz` — process liveness; does not depend on PostgreSQL.
- `GET /readyz` — readiness; returns 503 when PostgreSQL, writable media storage, FFmpeg, or FFprobe is unavailable.
- `GET /api/v1/system/health` — versioned liveness response.
- `GET /api/v1/system/identity` — public, safe installation bootstrap identity.

## Authentication

- `GET /api/v1/auth/status` — returns `setupRequired`, `authenticated`, and, for a valid session, the user and CSRF token.
- `POST /api/v1/auth/setup` — creates the single organization and first owner. Available exactly once.
- `POST /api/v1/auth/login` — creates an opaque database session.
- `POST /api/v1/auth/logout` — revokes the current session. Requires the session cookie and `X-CSRF-Token` header.

Setup body:

```json
{
  "organizationName": "North Library",
  "ownerName": "Taylor Morgan",
  "username": "owner@example.org",
  "password": "a long unique password"
}
```

Login body:

```json
{ "username": "owner@example.org", "password": "a long unique password" }
```

Authentication and setup are rate-limited per directly connected client address. When a reverse proxy is introduced, keep it on a trusted network; configurable trusted-proxy address handling will be added before internet-facing player APIs.

## Player bootstrap and authentication

- `POST /api/v1/player/pairing-sessions` — public, rate-limited pairing request.
- `GET /api/v1/player/pairing-sessions/{id}` — requires `Authorization: Pairing <poll-secret>`.
- `POST /api/v1/player/enroll` — exchanges a one-time enrollment token.
- `POST /api/v1/player/heartbeat` — requires a device Bearer credential.
- `GET /api/v1/player/socket` — authenticated WebSocket protocol version 1.

Device authentication errors use distinct codes: `device_credential_required`, `device_credential_invalid`, `device_credential_revoked`, and `screen_disabled`. Device credentials cannot authenticate dashboard endpoints.

## Screen administration

All screen routes require a dashboard session. Mutations also require `X-CSRF-Token`. Approval, rejection, updates, disable, enable, and revocation require Owner or Administrator.

- `GET /api/v1/screens`
- `GET /api/v1/screens/{id}`
- `GET /api/v1/screens/pairing/pending`
- `POST /api/v1/screens/pairing/resolve`
- `POST /api/v1/screens/pairing/{id}/approve`
- `POST /api/v1/screens/pairing/{id}/reject`
- `PATCH /api/v1/screens/{id}`
- `POST /api/v1/screens/{id}/disable`
- `POST /api/v1/screens/{id}/enable`
- `POST /api/v1/screens/{id}/revoke`

The machine-readable subset is in [`openapi.yaml`](openapi.yaml).

## Media uploads and library

All routes below require a dashboard session. Owner, Administrator, and Editor may mutate media; Viewer is read-only. Every mutation requires `X-CSRF-Token`.

- `POST /api/v1/uploads` creates a 24-hour resumable session.
- `HEAD /api/v1/uploads/{id}` returns `Upload-Offset`, `Upload-Length`, `Upload-Status`, and `Upload-Expires`.
- `PATCH /api/v1/uploads/{id}` accepts `application/offset+octet-stream` and requires the exact `Upload-Offset`. A mismatch returns `409 upload_offset_mismatch` without moving the accepted offset.
- `POST /api/v1/uploads/{id}/complete` validates size, synchronizes the file, hashes it, detects its actual type, atomically promotes it, creates the asset and original variant, and queues inspection. Repeating completion after success returns the same asset.
- `DELETE /api/v1/uploads/{id}` cancels an unfinished upload and removes temporary bytes.
- `GET /api/v1/assets` is paginated and supports `search`, `type`, `status`, `sort`, `page`, and `pageSize` (maximum 100).
- `GET`, `PATCH`, and `DELETE /api/v1/assets/{id}` read, edit, or soft-delete an asset.
- `POST /api/v1/assets/{id}/retry` retries a failed processing pipeline.
- `GET /api/v1/assets/{id}/thumbnail` streams the authenticated thumbnail or poster.

Uploaded filenames are display metadata only. API responses never include a storage key or filesystem path. Safe media errors include `unsupported_media_type`, `upload_too_large`, `upload_offset_mismatch`, `upload_expired`, `upload_incomplete`, `insufficient_storage`, `media_inspection_failed`, `media_processing_failed`, and `media_variant_unavailable`.

## Player media delivery

`GET` and `HEAD /api/v1/player/assets/{assetId}/variants/{variantId}` require an active device Bearer credential. Only ready, non-deleted, player-compatible variants are served. Disabled screens and revoked credentials are rejected before file access.

Responses include a hash-derived ETag, correct MIME type and length, and `Accept-Ranges: bytes`. Standard full, initial, middle, suffix, unsatisfiable, `If-Range`, and `If-None-Match` behavior is provided without loading the complete file into memory. Range reads are not audit events.

## Playlists, assignments, and manifests

Owner, Administrator, and Editor may create, edit, duplicate, reorder, or delete unassigned playlists; Viewer is read-only. Items accept only ready image/video assets with a player-compatible variant. Images require a positive duration, video offsets must remain within trusted duration, and reordering must contain every item exactly once.

Direct assignment routes are `/api/v1/screens/{id}/playlist-assignment`; only Owner and Administrator may mutate them. Responses contain the server manifest version and only status actually reported by the player.

`GET /api/v1/player/manifest` requires an active device credential, supports stable ETags and 304, and returns `playlist: null` when unassigned. Reads never advance the manifest version.

## Screen groups and schedules

Authenticated read routes are `GET /api/v1/screen-groups`, `GET /api/v1/screen-groups/{id}`, `GET /api/v1/schedules`, and `GET /api/v1/schedules/{id}`. Owner and Administrator mutations use the documented CSRF header on group create/update/delete and membership routes, schedule create/update/delete, and enable/disable routes. `POST /api/v1/schedules/preview` accepts `screenId`, an optional absolute `timestamp`, and an optional unsaved `proposedSchedule`; it returns precedence-ordered applicable schedules, conflicts, direct fallback, winner, and next transition using the production resolver.

Weekly weekdays are integers `0` (Sunday) through `6` (Saturday). Times are `HH:MM`, dates are `YYYY-MM-DD`, timezones are IANA identifiers, and an end time less than or equal to its start denotes an overnight window.

## Website assets

`POST /api/v1/assets/websites` creates a ready configuration-only website asset. `PATCH /api/v1/assets/{id}/website` updates its normalized configuration and revises only affected screen manifests. `GET /api/v1/assets/{id}/website/diagnostics` returns safe load timestamps, categorized failure state, reporting screens, allowed hosts, and fallback configuration. Website pages are never fetched as part of save.

Website playlist items require `durationMs` and always use `deliveryPolicy: "stream"`. Manifest schema v3 carries relevant website settings and optional fallback image/variant references. It never includes dashboard users, audit data, credentials, filesystem paths, full player logs, or unrelated websites.

`POST /api/v1/screens/{id}/website-data/clear` is Owner/Administrator-only and CSRF protected. It returns `202` with an expiring idempotent command. The lightweight WebSocket message contains only command ID and expiry; the player responds with a success flag and safe category.
