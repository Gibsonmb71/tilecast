# Span video walls

Span is the second Display Group mode. Mirror remains the default and keeps
the existing synchronized-group behavior. A screen still belongs to at most
one Display Group.

## Geometry

`PUT /api/v1/screen-groups/{id}/span` accepts `displayMode`, a logical canvas,
and one panel per member screen. Each panel has an `x`, `y`, `width`,
`height`, `order`, `rotation`, and optional bezel compensation. The server
rejects panels outside the canvas, duplicate screens or order values, invalid
rotations, and overlaps. Studio includes deterministic 2 × 1, 1 × 2, and
2 × 2 presets, while the same contract supports irregular layouts.

The authenticated Player manifest contains optional `canvas` and `viewport`
objects for Span screens. The canvas is the shared logical coordinate space;
the viewport is the panel assigned to that screen. Mirror manifests omit both
fields, so existing Players and installations retain their old manifest shape.

## Media preparation

Images and renderer-native layouts are projected against the logical canvas and
clipped to each Player viewport. Span video is different: the server creates a
deterministic panel variant for each screen and geometry revision. The durable
media worker uses bounded FFmpeg execution, constant frame rate, shared GOP and
forced-keyframe settings, and no audio track. Each Player therefore decodes a
normal panel-sized H.264 file instead of a wall-resolution source.

Panel output is not exposed until it is ready. Studio polls preparation status
and shows queued, processing, ready, and failed states. A failed preparation
leaves normal playback and the previously active manifest untouched; the next
manifest reconciliation retries after the operator changes the source or
geometry. Output paths are generated from the panel UUID and geometry hash,
never from an uploaded filename.

Panel variants use the existing authenticated Player delivery, manifest
versioning, shared playback epoch, reconnect reconciliation, and cache
verification paths. Geometry changes bump every member manifest. Old Linux
Players remain suitable for Mirror groups; Span requires a Player that accepts
manifest schema 15 and understands `canvas`/`viewport`. No player-side video
transcoding or giant wall-sized raster surface is required.

## Video duration and loop transitions

When a video item has no authored duration, the Player uses the source video
duration. An authored duration takes precedence. Image and renderer-native
items keep their authored durations.

When a grouped playlist loops one video, the Player restarts the same item in
place. It does not crossfade the item into itself. It keeps one decoder for the
loop, which prevents loop judder. Different items can still use a crossfade.

The wall status endpoint is `GET /api/v1/screen-groups/{id}/span`. Raw panel
delivery is device-authenticated at `GET /api/v1/player/span-panels/{id}`.
