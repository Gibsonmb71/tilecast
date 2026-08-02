# Version and publication history

Tilecast keeps two related but different histories:

- **Version history** is the immutable content checkpoints used for authoring,
  review, and recovery.
- **Publication history** records the exact checkpoints that reached the live
  runtime, who published them, when, why, and how many screens were affected.

This distinction answers both “what did an author save?” and “what was
actually live Tuesday at 10:14?” without using Audit Log entries as a rollback
source.

## Playlist drafts and live state

Playlist details, items, ordering, and tag rules now edit a separate working
draft. The normalized `playlists`, `playlist_items`, and `playlist_tags` rows
remain the published runtime representation consumed by manifests and the
scheduler. A draft edit increments the draft revision and updates Studio, but
does not bump a screen manifest, change schedule output, or notify a Player.

The header shows the working revision and the published revision. A submission
may freeze an older draft while an even newer working draft continues to move
forward.

Layouts use their existing mutable draft document and immutable published
revisions, with the same submission and publication workflow.

## Checkpoints and retention

Each submission stores a complete canonical snapshot and digest. Native
Playlist revisions remain whole snapshots containing the name, description,
source/tag rule, ordered items, playback settings, and tags. Layout revisions
store the published document. Campaign releases store campaign metadata,
destinations, time envelope, blocks, and the root Playlist/Layout revisions
used by those blocks.

The ordinary Playlist revision cap remains 30, but cleanup never removes a
checkpoint needed by the current publication, an active submission or schedule,
a Campaign release/publication, or another durable rollback pointer. History
is retained as far as the existing native snapshot data permits; it does not
fabricate states that were never stored.

## Semantic comparison

`GET /api/v1/content-history/{type}/{id}/compare` compares two publication IDs.
Studio leads with semantic changes rather than raw JSON:

- Playlists: details, tag rule, item additions/removals/reordering, and item
  playback/content changes.
- Layouts: canvas/orientation changes and placement additions/removals or
  configuration changes.
- Campaigns: metadata, destinations, and schedule-block changes.

The original immutable snapshot remains available through the corresponding
submission or release record for a detailed preview.

## Restore as draft

**Restore as draft** copies a selected publication into the mutable authoring
area. It does not change the published runtime, invalidate Players, delete
later history, or resurrect deleted media. The restored state must still pass
current validation and then be submitted/published normally. A missing or no
longer-valid reference is reported instead of silently producing a shorter or
different live playlist.

For Campaigns, restoring a release to draft copies the release definition and
its root revision references; generated schedules are not changed until a new
release is published.

## Rollback

Authorized content managers may use **Roll back** for an intentional live
change. Rollback reads the exact historical publication snapshot and creates a
new native revision and a new publication record with `method: rollback`. It
never moves a pointer backward or deletes the later publication.

When policy requires review, rollback creates an `in_review` submission and
cannot bypass approval. With review disabled for the caller, it can publish
atomically after current validation. Campaign rollback creates a new Campaign
release and materializes it through the same atomic Campaign scheduler path;
the superseded release remains in history.

## API and permissions

History reads are available to content authors. Restore-as-draft is available
to content authors; publication rollback requires the normal publish permission
(Owner/Administrator/Editor for Playlists and Layouts, Owner/Administrator for
Campaigns). All mutations require the dashboard CSRF token.

The primary endpoints are:

- `GET /api/v1/content-submissions` and `GET /api/v1/content-submissions/{id}`
- `POST /api/v1/content-submissions/{type}/{id}`
- `POST /api/v1/content-submissions/{id}/approve`
- `POST /api/v1/content-submissions/{id}/request-changes`
- `POST /api/v1/content-submissions/{id}/publish`
- `POST /api/v1/content-submissions/{id}/schedule` and
  `/cancel-schedule`
- `GET /api/v1/content-history/{type}/{id}/publications`
- `GET /api/v1/content-history/{type}/{id}/compare`
- `POST .../publications/{publicationId}/restore-draft`
- `POST .../publications/{publicationId}/rollback`

The older Playlist revision restore endpoint remains a compatibility route, but
new Studio history actions use Restore as draft so the published/live boundary
is explicit.
