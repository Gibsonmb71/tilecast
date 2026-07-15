# Apps, Sources, and layouts

Tilecast uses one closed provider registry for reusable signage behavior. Studio calls configured display-oriented instances **Apps**. Structured instances that primarily fetch and normalize data are **data Sources**. Both remain Content records backed by the existing `sources` storage and API domain for backward compatibility.

## Ownership

- A provider implements a built-in name, strict configuration schema, normalization, manifest projection, diagnostics, and native Player behavior.
- An App/Source instance owns reusable configuration and appears in the Studio Apps library, playlists, usage details, and the Layout library. Uploaded image and video files remain in the separate Assets library.
- A Layout placement references an instance by stable ID and owns only bounds, layer, opacity, visibility, and provider-approved presentation overrides.
- A Layout owns the complete composition and published revision.
- A playlist zone is a Layout region that plays an existing playlist. It is not an App.

Static text, shapes, lines, backgrounds, decorative uploaded images, and groups are native Layout primitives. Uploaded image and video Assets may also be placed directly. Website, YouTube, Clock, Date, QR Code, Ticker, Calendar, RSS, Atom, CSV, and JSON are provider-backed reusable Content. The registry never loads third-party code and rejects unknown providers and configuration properties.

Editing placement overrides must not mutate the referenced App. Studio must offer a separate **Edit shared App** action and warn when playlist or Layout usage means that change has multiple consumers. “Used in” includes every playlist and Layout that references the item.

App placements accept only the closed override keys `fit`, `alignment`, `foregroundColor`, `backgroundColor`, `fallbackVisibility`, and `muted`. Asset and playlist-zone placements use typed fit, mute, loop, fallback, and corner-radius settings. Publishing permits at most one visible video-capable placement or zone and one audio-emitting placement or zone. The server rejects other override properties and prevents deleting Content or playlists referenced by a draft or any immutable Layout revision.

## Structured data

CSV and JSON Sources own fetching, parsing, caching, field schema, row selection, refresh policy, and diagnostics. Layouts and display Apps own presentation. Built-in Menu, List, Table, Agenda, and Ticker Apps may reference a structured Source; constrained Layout bindings may reference its declared fields. Neither form duplicates the fetched dataset into each Layout revision.

A binding identifies a Source and declared field. The Source must also be an App placement in the Layout so its bounded cached dataset and date policy are projected to the Player. Display syntax such as `{{lunch.option_1}}` is editor shorthand that compiles to a typed field plus optional prefix and suffix. It is not a general template language and cannot execute expressions or code. Bindings support bounded fallback text, hide-when-empty behavior, and fixed text, date, number, integer, or currency formatting.

Menu, List, Table, and Agenda are closed-registry display Apps. Each stores only a Source reference, selected fields, an item limit, and safe colors. Menu and Table accept CSV/JSON Sources; Agenda accepts Calendar/CSV/JSON; List accepts Calendar/RSS/Atom/CSV/JSON. Updating a Source dataset updates every consumer without rewriting the display App or Layout.

Date-aware Sources store a mapped date field, fixed or detected format, IANA timezone, selection mode, and explicit no-match behavior. The manifest carries the bounded dataset and policy once. The Player evaluates the active record locally, uses timezone calendar rules across DST, and reevaluates at startup and local date changes without requiring a new Layout or manifest. It never assumes a day is 24 hours and never reuses yesterday’s record unless `last_known_good` is explicitly configured.

## Compatibility

Studio uses `/api/v1/apps`; `/api/v1/sources` remains an additive compatibility alias. Existing database rows, stable asset IDs, playlist items, Website/YouTube playback, and cached manifest versions remain valid. Internal package and table names may retain `source` where renaming would break storage or protocol compatibility.

Studio routes Apps and Assets separately. `/apps` lists reusable provider instances, `/apps/new/:provider` provides a full-page creator, and `/apps/:id` provides the corresponding full-page editor. `/assets` owns uploaded media and organization. The former `/content` route redirects to `/assets` for bookmarked-link compatibility.
