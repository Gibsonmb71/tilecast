# Playlist history

Layouts have kept a revision history with restore since Layouts shipped.
Playlists did not, and a playlist is the thing most likely to be edited in a
hurry while sitting on every screen at once. The audit log could say that a
playlist changed; it could not put it back.

Playlists now keep a history too. Nothing needs to be turned on.

## What is kept

Every playlist edit records a snapshot of the playlist as it then was: its name,
description, tag rule, and its ordered items with their durations, fit, volume,
and delivery settings.

The last **30** revisions per playlist are kept. Deep history on a playlist that
is edited daily is cost without a reader; what people reach for is the last few
states.

A revision is a whole snapshot rather than a list of changes. A change list has
to be replayed to be useful, and a replay that hits deleted media half way
through leaves the playlist in a state nobody authored. A snapshot restores or
it fails.

## Restoring

Open the playlist and use **History**. An Owner, Administrator, or Editor can
restore.

**A restore is a new edit, not a rewind.** It produces a new revision, so:

- the state it replaced stays in the history, and the restore can itself be
  undone the same way
- the manifest changes and screens pick the playlist up as normal
- if [content review](content-review.md) is required, the restored revision goes
  back for review, because it is a revision nobody has approved

## Deleted content is never resurrected

A restore keeps references to media and Layouts, not copies of them. If content
in the snapshot has since been deleted, the restore **skips that item and says
how many it skipped**. It does not bring deleted media back, and it does not
silently produce a shorter playlist without telling you.

The history list shows, per revision, how many of its items no longer exist. A
revision whose content has all been deleted is marked as having nothing left to
restore rather than offering a restore that would empty the playlist.

## Known limitations

- History starts when this feature ships. Edits made before it are not
  reconstructable. The first time a playlist's history is opened, Tilecast
  records its present state, so there is always at least one recoverable point.
- Only the last 30 revisions are kept, and the number is not configurable.
- A playlist deleted entirely takes its history with it.
- The history records what the playlist contained, not what a screen displayed.
  For that, see [Activity](activity.md) and [Snapshot history](snapshots.md).
