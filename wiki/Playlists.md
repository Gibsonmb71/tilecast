# Playlists

A playlist is an ordered fullscreen playback loop. It can contain uploaded images, uploaded videos, Website Sources, and YouTube Sources.

Owners, Administrators, and Editors can create and edit playlists. Viewers have read-only access.

## Create a playlist

1. Open **Playlists**.
2. Select **Create playlist**.
3. Enter a name.
4. Open the playlist.
5. Select **Add content**.
6. Choose one or more ready library items.

Items play from top to bottom, then the playlist loops.

## Reorder items

Drag an item by its handle and drop it in the new position.

Every content change increments the playlist revision. Screens receive a new manifest only when a playback-relevant assignment or playlist revision changes.

## Item settings

### Fit

| Mode    | Result                                          |
| ------- | ----------------------------------------------- |
| Contain | Show the entire item. Unused space can remain.  |
| Cover   | Fill the screen. The Player can crop the edges. |
| Stretch | Fill the screen without preserving aspect ratio |

### Transition

- None
- Fade

### Delivery

Uploaded media supports Download, Stream, or Automatic. Sources use Stream.

### Images and websites

Set the number of seconds each item remains active.

### Uploaded videos

Set:

- optional start offset
- optional end offset
- audio on or off
- volume

Without an end offset, the video plays to its end.

### YouTube

Choose:

- play until the video ends
- play for a fixed duration

YouTube playback settings stored on the Source provide defaults. The playlist item duration controls how long that Source occupies the playlist.

## Warnings

Studio shows playlist warnings when an item is not ready or no longer valid. Resolve warnings before using the playlist for an emergency takeover or critical schedule.

## Duplicate a playlist

Use **Duplicate** to make a variation of a playlist. The copy is independent. Changes to the copy do not change the original.

## Assign a playlist directly

Open a screen and select a playlist as its direct assignment.

The direct assignment is fallback content. It plays whenever no emergency or schedule is active.

## Use a playlist in a schedule

Create or edit a schedule and select the playlist. A schedule never changes the direct assignment.

## Safe activation

For downloaded items, Player prepares the full pending manifest before activation:

1. download required files
2. verify file size
3. verify SHA-256
4. atomically move verified files into the cache
5. activate the new manifest

If preparation fails, the previous working playback remains active.
