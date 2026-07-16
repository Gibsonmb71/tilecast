# Tilecast API

Milestone 1 exposes JSON endpoints under `/api/v1`. Successful responses use `{"data": ...}`. Errors use `{"error":{"code":"...","message":"..."}}`. Unknown JSON fields and request bodies over 1 MiB are rejected.

Milestone 9 adds Player release check/cache endpoints, Owner-only GitHub device-authorization start/poll/disconnect endpoints, deployment list/detail/create/cancel/retry endpoints, and device-authenticated update metadata, byte-range APK, and status endpoints. Only targeted screens can retrieve APK data. GitHub access tokens are never included in API responses. See [player-updates.md](player-updates.md) and `openapi.yaml`.

Milestone 10 adds `GET /screens/{id}/reliability` for capability-versus-requested-state diagnostics and `PUT /screens/{id}/power-assist` for explicit administrator confirmation of physical sleep, wake, TV, input-selection, and startup test results. Persistent commands add `retry_player_recovery`, `exit_safe_mode`, `power_assist_sleep`, and `power_assist_wake`; all use empty typed payloads and remain Owner/Administrator-only.

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
- `POST /api/v1/screens/pairing/{id}/approve` — accepts `replaceExistingCredential` (default `false`); an existing active credential otherwise returns `pairing_recovery_required`.
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
- `GET /api/v1/assets` is paginated and supports `search`, `type`, `status`, `folderId`, `collectionId`, `tagId`, `sort`, `page`, and `pageSize` (maximum 100).
- `GET`, `PATCH`, and `DELETE /api/v1/assets/{id}` read, edit, or soft-delete an asset.
- `POST /api/v1/assets/{id}/retry` retries a failed processing pipeline.
- `GET /api/v1/assets/{id}/thumbnail` streams the authenticated thumbnail or poster.
- `GET` and `HEAD /api/v1/assets/{id}/preview` stream the authenticated, player-compatible image or video variant for Studio previews, including byte-range requests.

Uploaded filenames are display metadata only. API responses never include a storage key or filesystem path. Safe media errors include `unsupported_media_type`, `upload_too_large`, `upload_offset_mismatch`, `upload_expired`, `upload_incomplete`, `insufficient_storage`, `media_inspection_failed`, `media_processing_failed`, and `media_variant_unavailable`.

### Content organization

Folders, collections, and tags are installation-scoped metadata. Authenticated users can list them through `GET /api/v1/content-folders`, `/content-collections`, and `/content-tags`. Owner, Administrator, and Editor mutations require CSRF. Creation and deletion use the matching collection route; folders also support `PATCH /content-folders/{id}` for hierarchy and details.

`POST /api/v1/assets/bulk-organize` accepts 1–250 unique `assetIds`, an optional folder assignment, and tag or collection additions/removals. It validates every asset and referenced organization record before applying an all-or-nothing transaction. Deleting a folder moves its direct content to Unfiled and moves child folders to the root. Deleting a tag or collection removes only its relationships and never deletes content. These records are Studio metadata and do not change Player manifests.

## Player media delivery

`GET` and `HEAD /api/v1/player/assets/{assetId}/variants/{variantId}` require an active device Bearer credential. Only ready, non-deleted, player-compatible variants are served. Disabled screens and revoked credentials are rejected before file access.

Responses include a hash-derived ETag, correct MIME type and length, and `Accept-Ranges: bytes`. Standard full, initial, middle, suffix, unsatisfiable, `If-Range`, and `If-None-Match` behavior is provided without loading the complete file into memory. Range reads are not audit events.

## Playlists, assignments, and manifests

Owner, Administrator, and Editor may create, edit, duplicate, reorder, or delete unassigned playlists; Viewer is read-only. Items accept only ready image/video assets with a player-compatible variant. Images require a positive duration, video offsets must remain within trusted duration, and reordering must contain every item exactly once.

Direct assignment routes remain `/api/v1/screens/{id}/playlist-assignment` for compatibility; only Owner and Administrator may mutate them. A `PUT` body contains exactly one of `playlistId` or `layoutId`, and a Layout must have a published revision. For a sync-group member the route updates the group-owned presentation and revises every member manifest. Sync groups use the same exclusive body on `/api/v1/screen-groups/{id}/playlist-assignment`. Existing playlist assignments remain intact after migration.

`GET /api/v1/player/manifest` requires an active device credential, supports stable ETags and 304, and returns manifest v11 with a root playlist or Layout presentation. Layout projection contains the immutable published document plus only its required Widgets, playlist zones, Data Sources (bounded cached datasets), and verified media variants. Reads never advance the manifest version.

## Sync groups and schedules

The API retains `/screen-groups` paths for compatibility, while Studio calls these resources Sync Groups. A database unique constraint permits each screen in at most one sync group. Adding an already-grouped screen returns `409`; removing a screen preserves the group fallback as that screen's independent assignment. Authenticated read routes are `GET /api/v1/screen-groups`, `GET /api/v1/screen-groups/{id}`, `GET /api/v1/schedules`, and `GET /api/v1/schedules/{id}`. Owner and Administrator mutations use the documented CSRF header on group create/update/delete and membership routes, schedule create/update/delete, and enable/disable routes.

Schedule targets for a grouped screen are normalized to its sync group, so every member receives the same schedule set. Schedule create, update, and preview inputs contain exactly one of `playlistId` or `layoutId`; existing playlist schedules remain intact. `POST /api/v1/schedules/preview` returns precedence-ordered applicable schedules, conflicts, fallback content, winner, and next transition using the production resolver. Players resolve the active playlist or Layout locally, including while offline.

Weekly weekdays are integers `0` (Sunday) through `6` (Saturday). Times are `HH:MM`, dates are `YYYY-MM-DD`, timezones are IANA identifiers, and an end time less than or equal to its start denotes an overnight window.

## Website assets

`POST /api/v1/assets/websites` creates a ready configuration-only website asset. `PATCH /api/v1/assets/{id}/website` updates its normalized configuration and revises only affected screen manifests. `GET /api/v1/assets/{id}/website/diagnostics` returns safe load timestamps, categorized failure state, reporting screens, allowed hosts, and fallback configuration. Website pages are never fetched as part of save.

Website playlist items require `durationMs` and always use `deliveryPolicy: "stream"`. Manifest schema v3 carries relevant website settings and optional fallback image/variant references. It never includes dashboard users, audit data, credentials, filesystem paths, full player logs, or unrelated websites.

Website data clearing is the typed `clear_website_data` persistent player command. It is Owner/Administrator-only and CSRF protected.

## Widgets and Data Sources

Tilecast separates renderable **Widgets** from non-visual **Data Sources**. See [widgets-and-layouts.md](widgets-and-layouts.md) for the full model.

`POST /api/v1/widgets` creates a reusable Widget from the release-owned definition catalog or a retained trusted legacy provider. Data-driven Widgets reference compatible Data Sources by ID; the server validates source existence, output kind, required fields and types, bounds, enums, colors, URLs, and media references.

Widget requests and responses may include nullable authoring-only `presetId` metadata for Leaderboard, Status Board, Queue Board, Schedule / Departures, Opening Hours, and Directory. Presets compile through their underlying generic provider and `presetId` is omitted from Player presentation logic.

`GET /api/v1/content-definitions` returns the Server-owned catalog used by Studio to build galleries, categories, defaults, forms, compatibility filters, field selectors, and validation guidance. Definitions are embedded in Tilecast releases; this endpoint does not accept uploads or third-party code. `GET /api/v1/provider-catalog` remains as a compatibility endpoint.

`GET /api/v1/data-sources` includes the established providers plus the release-defined School Status manual object Source. School Status emits Data Document v1 object fields `status`, `message`, `severity`, `effectiveAt`, `expiresAt`, and `updatedAt`. Player manifests never contain fetch URLs, uploaded CSV bytes, coordinates, contacts, source credentials, or upstream request details.

`POST /api/v1/data-sources/{provider}/preview` performs a bounded real fetch and returns sanitized prepared data plus diagnostics before save. JSON mappings use only RFC 6901 JSON Pointer; CSV uses exact header names. An optional `previewDate` evaluates configured date selection without changing saved data. `GET /api/v1/data-sources/{id}/diagnostics` returns bounded refresh and cache diagnostics without raw payloads.

Manifest v11 and v12 remain accepted for staged upgrades. Compatible Players receive manifest v13, where provider-neutral typed documents may contain multiple named datasets and Widget presentations dispatch by kind and required capabilities rather than provider name. Date-only records remain calendar dates and timestamps remain RFC 3339.

The School Status Banner demonstrates the release-definition path. Studio generates its form from the catalog, the Server validates and compiles it to existing `surface`, `column`, `badge`, `text`, and `conditional` nodes, and Android receives no provider-specific configuration or template.

## Layouts

`GET/POST /api/v1/layouts` lists or creates Layouts. `GET/PATCH /api/v1/layouts/{id}` reads or edits metadata, and `PUT /api/v1/layouts/{id}/draft` autosaves a validated renderer-neutral document with `expectedDraftRevision` optimistic concurrency. Successful draft reads and writes include an ETag. `POST /api/v1/layouts/{id}/publish` creates an immutable revision; Players never receive a draft.

`GET /api/v1/layouts/{id}/revisions` returns paginated immutable history. `POST /api/v1/layouts/{id}/revisions/{revisionId}/restore` copies an old document into a new draft revision without changing history. Duplicate and delete operations are `POST /api/v1/layouts/{id}/duplicate` and `DELETE /api/v1/layouts/{id}`. Validation errors use `layout_validation_failed`; stale draft writes use `layout_revision_conflict`.

Content responses include `layoutUsage` with stable Layout IDs, names, and published state. Content deletion returns `asset_in_use` when a draft or published revision depends on the item. Layout App placements contain only the Content ID and approved presentation overrides; shared provider configuration remains in Content.

Manifest v10 adds root and scheduled Layout presentations. A Layout entry includes its published revision, document SHA-256, validated document, and materialized dependencies. Layout deletion is blocked while assigned or scheduled; dependency deletion is blocked while referenced by a draft or published revision.

## Emergency takeover and commands

Dashboard routes include `GET/POST /emergencies`, `GET /emergencies/{id}`, `POST /emergencies/{id}/cancel`, `GET/POST /screens/{id}/commands`, and command cancellation. Device-authenticated players use `GET /player/commands`, `POST /player/commands/{id}/acknowledge`, and `POST /player/commands/{id}/result`. Commands are typed, bounded, expiring, and scoped to the authenticated screen. The former one-off website clearing route is replaced by `clear_website_data`.

## Settings and configuration

Organization settings use `GET/PATCH /settings` with optimistic revision checking. Preferences use `GET/PATCH /me/preferences`. Group and screen policies have typed GET/PUT/DELETE routes; `/screens/{id}/effective-policy` returns values and administrative sources. Players receive source-free effective values from `/player/config` with ETag support. System status and fixed maintenance actions expose health without secrets. Owner import/export requires preview before apply.

Stable settings errors include `unknown_setting`, `invalid_setting_value`, `setting_not_allowed_at_scope`, `setting_exceeds_hard_limit`, `settings_revision_conflict`, `settings_import_invalid`, `settings_import_version_unsupported`, and `branding_asset_invalid`.

## Declarative presentation runtime

`GET /api/v1/provider-catalog` returns the legacy compatibility catalog. `GET /api/v1/content-definitions` returns the authoritative release definitions. `POST /api/v1/widgets/compile-preview` compiles an authorized draft into the same resolved declarative presentation document used by v13 manifests.

Player heartbeats may include `presentationSchemaVersions`, `nativePresentationCapabilities`, `webRuntimeVersion`, and `webBundleLimitBytes`. The server uses these bounded fields for v13 negotiation; they never authorize arbitrary executable features.
