# Widgets, Data Sources, and Layouts

Tilecast separates reusable signage behavior into two distinct kinds of record backed by one closed provider registry.

- **Data Sources** provide data.
- **Widgets** display content.
- **Layouts** arrange Widgets and Media.
- **Playlists** sequence Widgets and Media.

Uploaded images and videos are **Media** and live in their own library. Data Sources are not Media and are not Widgets.

## Data Sources

A Data Source is a reusable, non-visual connection. It owns everything about acquiring data and nothing about how it looks:

- connection URL or uploaded payload
- fetching, parsing, and field mapping
- refresh interval, caching, and staleness policy
- filters and sorting
- date-aware record selection
- offline cached data and diagnostics
- a typed field schema

Providers: **Calendar, RSS, Atom, JSON, CSV, Manual Table, Weather**. Manual Table stores a bounded typed dataset directly in Studio. Weather caches a normalized global forecast from MET Norway and projects mandatory attribution without exposing coordinates or the installation contact to the Player. A Data Source cannot be assigned to a screen, added to a playlist, or dragged into a Layout as visual content. The only way a Layout may reference one directly is a custom dynamic text binding that names one declared field.

Data Sources appear in their own Studio section. Each detail view shows the provider, current status, last successful and last attempted refresh, cached record count, available fields, date-selection policy, errors and diagnostics, the Widgets using the Data Source, and the Layout text bindings using it.

## Widgets

A Widget owns how content appears. A Widget is either **standalone** or references exactly **one** Data Source. It owns visual settings, the selected Data Source, selected fields, labels, typography, colors, spacing, record count, empty-state presentation, and provider-specific behavior. It does **not** own fetching, parsing, source refresh, cached records, date selection, or source diagnostics — those belong to the Data Source.

- Standalone providers: **Website, YouTube, Clock, Date, QR Code, Countdown**.
- Data-driven providers: **Ticker, Menu / Price Board, List, Table, Agenda, Metric, Cards, Weather**.

A Widget is a Content record (an asset of type `widget`) and may play fullscreen in a playlist or be placed inside a Layout. Editing a Widget placement in a Layout must not mutate the shared Widget; Studio offers an explicit **Edit shared Widget** action and reports every playlist and Layout that consumes it.

Native Widget content automatically follows the Widget's rendered bounds, whether it is fullscreen, in a playlist zone, or directly placed in a Layout. The default `contentPadding` is 10 percent on each edge, giving the content the center 80 percent of the Widget; authors may set it from 0–40 percent. Long text is fitted within that area, and dense list-style Widgets reduce row typography or visible rows instead of clipping. Authors may optionally set `textScale` from 25–500 percent to reduce or enlarge provider typography; omitting it keeps automatic bounds-first sizing. Fit-to-bounds remains the final guard.

### Data-driven Widget compatibility

The server validates that the selected Data Source provider is compatible with the Widget provider and that every selected field exists in the Data Source schema.

| Widget             | Accepted Data Sources                    |
| ------------------ | ---------------------------------------- |
| Ticker             | Any record-based Data Source             |
| Menu / Price Board | Any record-based Data Source             |
| List               | Any record-based Data Source             |
| Table              | Any record-based Data Source             |
| Agenda             | Calendar or another temporal Data Source |
| Metric             | A Data Source exposing a numeric field   |
| Cards              | Any record-based Data Source             |
| Weather            | Weather Data Source                      |

The registry never loads third-party code and rejects unknown providers, unknown configuration keys, scripts, HTML templates, and executable expressions.

## Layouts

A Layout arranges Media, Widgets, static text, shapes, playlist zones, and groups. Data Sources are never listed as normal draggable content.

A Widget placement stores only a Widget ID, bounds, layer, opacity, visibility, and provider-approved presentation overrides. Placements accept only the closed override keys `fit`, `alignment`, `foregroundColor`, `backgroundColor`, `fallbackVisibility`, and `muted`. Publishing permits at most one visible video-capable placement or zone and one audio-emitting placement or zone.

Custom text primitives may bind directly to a Data Source field using a safe typed binding model: the binding names a `dataSourceId` and one declared `field`, with optional prefix, suffix, bounded fallback text, hide-when-empty behavior, and fixed text/date/number/integer/currency formatting. Display syntax such as `{{lunch.option_1}}` is editor shorthand that compiles to a typed field reference; it is not a template language and cannot execute code. The bound Data Source is referenced directly — it is **not** placed in the Layout — and its bounded cached dataset and date policy are projected to the Player once and shared.

## Date-aware structured content

Date-aware Data Sources store a mapped date field, a fixed or detected format, an IANA timezone, a selection mode (today, tomorrow, next available date, current week, custom range), whether past records are excluded, and explicit no-match behavior. The manifest carries the bounded dataset and policy once. The Player evaluates the active record locally, uses timezone calendar rules across DST, and reevaluates at startup and on local date changes, DST transitions, reboot, sleep recovery, timezone changes, and clock corrections — without requiring a new Layout, Widget revision, or manifest. It never assumes a day is 24 hours and never reuses yesterday's record unless `last_known_good` is explicitly configured. Studio can preview a Data Source with a selected date.

## Manifest and the Player

The Player manifest projects Widgets and Data Sources as separate arrays. Manifest v12 normalizes every Data Source into typed field definitions and bounded records, with cache state, optional date-selection policy, and optional attribution. The Player renders Widgets natively, shares one dataset across consumers, continues date-aware selection locally, and preserves offline playback. Players supporting v12 continue accepting cached v11 manifests.

Manifest v13 adds a stable declarative runtime boundary. Data Sources project provider-neutral scalar, record, time-series, list, or object datasets. Native Widgets compile to a closed, non-executable tree of layout, content, and bounded collection nodes. Website and YouTube Widgets compile to constrained web descriptors with explicit hosts, timeouts, fallback behavior, and lifecycle. The Player dispatches on presentation kind and node type rather than provider names.

Provider creation remains limited to Tilecast releases. Studio does not expose raw presentation JSON, uploaded scripts, arbitrary templates, or third-party runtime code. New providers using existing data kinds, nodes, formatters, and web capabilities therefore need only a server and Studio release; genuinely new native primitives still require a capability-bearing Player update.

Presentations containing only legacy Widget configurations continue using manifest v11. Saving a generalized data-driven Widget upgrades it to configuration version 2 and requires manifest v12. Studio refuses to assign v12 content to a screen or synchronized group until every target reports a compatible Player version.

The v13-compatible Player reports presentation schema versions, native capability identifiers and versions, web runtime version, and bundle size limits. The server emits v13 only after that report and retains v11/v12 dual projection for staged upgrades.

## Deletion and usage

- Deleting a Data Source is refused while any Widget or Layout binding uses it; the error names the dependents.
- Deleting a Widget is refused while any playlist or Layout uses it.

## Worked example

```text
Elementary Lunch Data
Type: CSV Data Source
```

```text
Today's Lunch
Type: Menu Widget
Data Source: Elementary Lunch Data
```

```text
Cafeteria Layout
Contains: Today's Lunch Widget
```

The CSV Data Source fetches, parses, caches, and date-selects the lunch rows. The Menu Widget owns the presentation and references the Data Source by `dataSourceId`. The Layout places the Menu Widget. Updating the CSV dataset updates every consumer without rewriting the Widget or the Layout.

## API and routing

Studio uses `/api/v1/widgets` for Widgets and `/api/v1/data-sources` for Data Sources. There are no `/api/v1/apps` or `/api/v1/sources` aliases. `/assets` owns uploaded Media. Studio Content is organized into Media, Widgets, and Data Sources sections.
