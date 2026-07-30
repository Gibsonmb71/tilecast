# Bulk changes

**Screens**, **Bulk changes** applies one change to many screens.

Only an Owner or an Administrator can use it.

## The preview is the point

Nothing is applied until you confirm a preview. The preview lists every screen
that the change touches and shows the current state next to the next state.

It reports three groups, and the confirmation button counts only the first:

- Screens that change.
- Screens that are already in that state. These are listed and skipped.
- Screens that cannot change. These are listed with the reason.

A screen is blocked when it is archived, when it has no active Player
credential, or, for a command, when playback is disabled.

## Sync groups change more screens than you select

A screen in a sync group shares that group's assignment. Assigning one member
assigns every member. This is how sync groups work, and it is the reason the
preview exists.

The preview adds those screens, marks each one with the group that included it,
and states the total in a warning. A selection of six screens can be a change
to sixty, and you see that before it happens.

## Actions

| Action                     | Notes                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| Assign a playlist          |                                                                  |
| Assign a Layout            | Published Layouts only                                           |
| Remove the assignment      |                                                                  |
| Enable or disable playback |                                                                  |
| Send a command             | Sync now, reload playback, clear media cache, restart the Player |

Each action runs through the same code as the single-screen equivalent, so the
manifest change, the sync-group fan-out, the Player-version compatibility check,
and the audit entries are identical.

## What is not here, and why

- **Player updates.** An update deployment already accepts a list of screens
  and groups. Use **Settings**, **Player updates**.
- **Player policy.** A group policy already applies one policy to every screen
  in the group. Use **Settings** on the sync group.

Both already do this work. A second path to the same result would drift from the
first.

## Undo

An assignment change or an enable change can be undone for 15 minutes. Undo
restores the previous assignment for each screen it changed.

The window is short on purpose. Undo is for the misclick you notice at once. The
longer the window, the more likely undo would quietly reverse a deliberate later
change by somebody else.

Undo is an ordinary change: it writes its own audit entries and bumps the
manifest again. It does not rewrite history.

**A command cannot be undone.** A Player may collect it immediately. Tilecast
says so before you send, and offers no undo control afterward.

## Limits and safety

- No more than 500 screens in one operation. A larger request is refused rather
  than half applied.
- Apply sends the change count from the preview you confirmed. When the fleet
  has moved since -- somebody else reassigned a screen, a group gained a member
  -- the apply is refused with `bulk_operation_stale` and you review again.
- A screen that fails during apply is reported with its reason. The rest of the
  operation continues; an operation that half worked says which half.
- Every operation is recorded with the per-screen outcome, and the individual
  changes keep their own audit entries.
