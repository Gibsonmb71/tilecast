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

Initial providers: **Calendar, RSS, Atom, JSON, CSV**. A Data Source cannot be assigned to a screen, added to a playlist, or dragged into a Layout as visual content. The only way a Layout may reference one directly is a custom dynamic text binding that names one declared field.

Data Sources appear in their own Studio section. Each detail view shows the provider, current status, last successful and last attempted refresh, cached record count, available fields, date-selection policy, errors and diagnostics, the Widgets using the Data Source, and the Layout text bindings using it.

## Widgets

A Widget owns how content appears. A Widget is either **standalone** or references exactly **one** Data Source. It owns visual settings, the selected Data Source, selected fields, labels, typography, colors, spacing, record count, empty-state presentation, and provider-specific behavior. It does **not** own fetching, parsing, source refresh, cached records, date selection, or source diagnostics — those belong to the Data Source.

- Standalone providers: **Website, YouTube, Clock, Date, QR Code**.
- Data-driven providers: **Ticker, Menu, List, Table, Agenda**.

A Widget is a Content record (an asset of type `widget`) and may play fullscreen in a playlist or be placed inside a Layout. Editing a Widget placement in a Layout must not mutate the shared Widget; Studio offers an explicit **Edit shared Widget** action and reports every playlist and Layout that consumes it.

### Data-driven Widget compatibility

The server validates that the selected Data Source provider is compatible with the Widget provider and that every selected field exists in the Data Source schema.

| Widget  | Accepted Data Sources                |
| ------- | ------------------------------------ |
| Ticker  | RSS, Atom, Calendar, JSON, CSV       |
| Menu    | CSV, JSON                            |
| List    | Calendar, RSS, Atom, JSON, CSV       |
| Table   | JSON, CSV                            |
| Agenda  | Calendar, date-aware JSON, date-aware CSV |

The registry never loads third-party code and rejects unknown providers, unknown configuration keys, scripts, HTML templates, and executable expressions.

## Layouts

A Layout arranges Media, Widgets, static text, shapes, playlist zones, and groups. Data Sources are never listed as normal draggable content.

A Widget placement stores only a Widget ID, bounds, layer, opacity, visibility, and provider-approved presentation overrides. Placements accept only the closed override keys `fit`, `alignment`, `foregroundColor`, `backgroundColor`, `fallbackVisibility`, and `muted`. Publishing permits at most one visible video-capable placement or zone and one audio-emitting placement or zone.

Custom text primitives may bind directly to a Data Source field using a safe typed binding model: the binding names a `dataSourceId` and one declared `field`, with optional prefix, suffix, bounded fallback text, hide-when-empty behavior, and fixed text/date/number/integer/currency formatting. Display syntax such as `{{lunch.option_1}}` is editor shorthand that compiles to a typed field reference; it is not a template language and cannot execute code. The bound Data Source is referenced directly — it is **not** placed in the Layout — and its bounded cached dataset and date policy are projected to the Player once and shared.

## Date-aware structured content

Date-aware Data Sources store a mapped date field, a fixed or detected format, an IANA timezone, a selection mode (today, tomorrow, next available date, current week, custom range), whether past records are excluded, and explicit no-match behavior. The manifest carries the bounded dataset and policy once. The Player evaluates the active record locally, uses timezone calendar rules across DST, and reevaluates at startup and on local date changes, DST transitions, reboot, sleep recovery, timezone changes, and clock corrections — without requiring a new Layout, Widget revision, or manifest. It never assumes a day is 24 hours and never reuses yesterday's record unless `last_known_good` is explicitly configured. Studio can preview a Data Source with a selected date.

## Manifest and the Player

The Player manifest projects Widgets and Data Sources as separate arrays. A Layout or playlist manifest contains the required Widget configurations, the required Media, and only the Data Sources needed by those Widgets or Layout bindings, each with a bounded cached dataset, date-selection policy, and integrity metadata. The Player renders Widgets natively, keeps Data Source fetching and selection separate from rendering, shares one cached Data Source dataset across multiple Widgets, continues date-aware selection locally, never copies a dataset into each Widget runtime, and preserves offline playback and cached Layout recovery.

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
