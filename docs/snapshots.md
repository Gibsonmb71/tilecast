# Snapshot history

Live preview answers "what is on that screen now" and forgets. Snapshot history
answers "what was on it at 10:14".

That is the question asked after somebody reports a wrong board, or over a break
when nobody is in the building.

Snapshot history is **off by default**.

## Snapshot source

Snapshots are captured from the Tilecast Player render surface.

## Turning it on

**Settings**, **Snapshot history**:

| Setting                      | Default    | Purpose                                                               |
| ---------------------------- | ---------- | --------------------------------------------------------------------- |
| Keep a snapshot history      | off        | Nothing is captured or stored while this is off                       |
| Capture every                | 60 minutes | Minimum 15                                                            |
| Keep snapshots for           | 7 days     | Retention period                                                      |
| Snapshots to keep per screen | 48         | The oldest go once a screen reaches this, whatever the retention says |

The interval, the retention period, and the per-screen count are three
independent caps. The per-screen cap is applied when a snapshot is written, not
only on the retention sweep, so a short interval cannot fill the database
between two sweeps.

## Storage, and what it costs

Snapshots are stored in the database, the same as the existing live preview
image. That has a consequence worth stating plainly: **snapshots are inside
every database backup**, so turning this on makes backups larger.

The caps are what keep it bounded. **Settings**, **Snapshot history** reports the
current total so the cost is visible rather than discovered in a backup.

## How a snapshot is captured

Tilecast asks the Player for a frame through the ordinary live preview lease. It
is one capture path, so a manual preview and a scheduled snapshot cannot
disagree about what a screen showed. A frame captured by a person pressing the
preview button is kept alongside the scheduled ones and marked `manual`.

Only screens that are currently reporting are asked. That also covers active
hours without a separate setting: a screen asleep outside its active hours is
not reporting, so it is not asked. A screen that is offline simply does not
answer, and the next sweep asks again.

## Who can see them

Snapshot history follows the same rules as the screen itself. A scoped account
sees snapshots only for screens inside its
[screen scope](screen-scopes.md), and the image is fetched through the screen, so
a snapshot cannot be reached through a screen the account is not authorized for.

## Known limitations

- Capture depends on the Player. On Linux, live capture is best on X11; on
  Wayland it depends on the screen-capture portal and may miss
  hardware-overlay video and website frames. See
  [Live previews](live-previews.md).
- A missing snapshot is not evidence that a screen was wrong. It usually means
  the screen was not reporting when Tilecast asked.
- Snapshots are not proof of play. Proof of play is a separate, Player-confirmed
  record. See [Activity](activity.md).
- There is no alerting on snapshot content. Tilecast does not inspect the image.
- Turning history off stops new captures and lets retention clear what is there.
  It does not delete everything at once.
