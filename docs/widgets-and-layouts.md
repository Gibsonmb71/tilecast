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

Providers: **Calendar, RSS, Atom, JSON, CSV, Manual Table, Weather, Transit, CAP Alerts, and Air Quality**. Transit joins public GTFS Static metadata with Realtime trip updates and optional service alerts. CAP Alerts normalizes active public CAP 1.2 warnings. Air Quality exposes current and hourly Open-Meteo/CAMS values with mandatory attribution and a noncommercial-or-self-hosted endpoint policy. A Data Source cannot be assigned to a screen, added to a playlist, or dragged into a Layout as visual content.

Release-defined Data Sources add three further groups, all built on generic adapters rather than provider-specific code:

- **Single current value** (`manual_object`): School Status, Emergency Message, Fundraising Goal, Occupancy Count, and Today's Hours. Each maintains one typed object in Studio.
- **Studio-maintained tables** (`manual_records`): Announcements, Events, Closures and Delays, Directory, Menu Items, and Shout-outs. See [Time-windowed record tables](#time-windowed-record-tables).
- **Guided public feeds** (`http_records`): Google Sheet, US Weather Alerts, and Public Holidays. See [Guided public feeds](#guided-public-feeds).

Data Sources appear under the Data tab of the Studio Content workspace, and are also created inline from any Widget or Layout binding that needs one. Each detail view shows the provider, current status, last successful and last attempted refresh, cached record count, available fields, date-selection policy, errors and diagnostics, the Widgets using the Data Source, and the Layout text bindings using it. Usage entries link to the records that consume the Data Source.

## Widgets

A Widget owns how content appears. A Widget is either **standalone** or references exactly **one** Data Source. It owns visual settings, the selected Data Source, selected fields, labels, typography, colors, spacing, record count, empty-state presentation, and provider-specific behavior. It does **not** own fetching, parsing, source refresh, cached records, date selection, or source diagnostics — those belong to the Data Source.

- Standalone providers: **Website, YouTube, Clock, Date, QR Code, Countdown, World Clock**, plus the release-defined **Text Notice, Image Notice, and QR Call to Action**.
- Data-driven providers: **Ticker, Menu / Price Board, List, Table, Agenda, Metric, Cards, Weather, Spotlight, Stat Grid, Chart, Progress, Timeline**, plus the release-defined **School Status Banner, Alert Banner, Fundraising Thermometer, Now and Next, and Recognition Board**.

Studio also offers the guided presets **Leaderboard, Status Board, Queue Board, Schedule / Departures, Opening Hours, and Directory**. Presets persist authoring-only `presetId` metadata and compile through their underlying generic provider; the Player does not dispatch on preset identity.

A Widget is a Content record (an asset of type `widget`) and may play fullscreen in a playlist or be placed inside a Layout. Editing a Widget placement in a Layout must not mutate the shared Widget; Studio offers an explicit **Edit shared Widget** action and reports every playlist and Layout that consumes it.

Native Widget content automatically follows the Widget's rendered bounds, whether it is fullscreen, in a playlist zone, or directly placed in a Layout. The default `contentPadding` is 10 percent on each edge, giving the content the center 80 percent of the Widget; authors may set it from 0–40 percent. Long text is fitted within that area, and dense list-style Widgets reduce row typography or visible rows instead of clipping. Authors may optionally set `textScale` from 25–500 percent to reduce or enlarge provider typography; omitting it keeps automatic bounds-first sizing. The scale multiplies the automatic size, so scales above 100 percent genuinely enlarge the content rather than being capped at the automatic fit. Fit-to-bounds remains the final guard: a scale that would overflow the content area is shrunk back on measurement instead of clipping.

Both values are percentages the whole way down. A v13 presentation carries them on its `surface` node as `paddingPercent` and `textScale`, and every renderer resolves the padding against the Widget's own bounds — never as absolute pixels or dp. The legacy `padding` prop remains on the node for Players that predate the percentage props.

Countdown Widgets may run once or repeat daily, weekly, monthly, or yearly in their configured IANA timezone. Monthly and yearly recurrences preserve the selected local day and time, clamping dates such as the 31st or February 29 to the final valid day when necessary. The title can appear above the countdown, beside it, or be hidden with the countdown-only layout. Recurrence is available for count-down mode; one-time countdowns retain their completion-text, hide, and continue-counting-up behaviors.

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

| Now and Next | Any record-based Data Source |
| Recognition Board | Any record-based Data Source |
| Alert Banner | An object Data Source exposing message and severity |
| Fundraising Thermometer | An object Data Source exposing two numeric fields |

The registry never loads third-party code and rejects unknown providers, unknown configuration keys, scripts, HTML templates, and executable expressions.

### Time-windowed record tables

A `manual_records` Data Source is a bounded table maintained in Studio. Unlike Manual Table, its rows carry their own visibility window, so content retires itself:

| Output field | Behavior when the definition declares it   |
| ------------ | ------------------------------------------ |
| `publishAt`  | The row is hidden until this moment.       |
| `expiresAt`  | The row is hidden from this moment onward. |
| `priority`   | Higher values sort first.                  |

The keys are conventions read from the definition's output schema, not requirements. A definition that declares none of them produces an unfiltered list in the order the author entered. Rows are otherwise ordered by descending priority, then by the definition's first declared date or datetime field.

Visibility depends on the clock rather than on an edit, so the projection also reports the next moment the visible set changes. The Server schedules that Data Source's next refresh for exactly that moment instead of polling, and bumps affected manifests only when the projected payload actually changed. Entering tomorrow's closures tonight with a publish time therefore reaches every screen in the morning without anyone touching Studio, and an expired announcement disappears without a cleanup pass. A table is bounded at 200 visible rows.

### Guided public feeds

An `http_records` Data Source fetches an endpoint that the **release** pins and maps the response using a mapping the release fixes. It exists so a recognizable source ("a published Google Sheet", "active weather alerts for a state") can ship as a definition instead of another bespoke provider. It is deliberately narrower than the JSON and CSV providers, which remain the right choice for an arbitrary endpoint an operator maps by hand:

- The scheme and host come from the definition. A definition whose URL template placed a placeholder in its scheme or host is rejected at startup.
- The author fills only the placeholders the definition declares, and each substituted value is percent-encoded, so a value can never add a path segment, add a query parameter, or reach another host.
- The response mapping is a set of plain dot paths (JSON) or column names (CSV). There are no expressions, scripts, or templates.
- Every request still passes the standard source-fetch policy: private-network refusal, size cap, redirect cap, and timeout.

Attribution declared by the definition is carried through to the Player alongside the records.

## Layouts

A Layout arranges Media, Widgets, static text, shapes, playlist zones, and groups. Data Sources are never listed as normal draggable content.

A Widget placement stores only a Widget ID, bounds, layer, opacity, visibility, and provider-approved presentation overrides. Placements accept only the closed override keys `fit`, `alignment`, `foregroundColor`, `backgroundColor`, `fallbackVisibility`, and `muted`. Publishing permits at most one visible video-capable placement or zone and one audio-emitting placement or zone.

Custom text primitives may bind directly to a Data Source field using a safe typed binding model: the binding names a `dataSourceId` and one declared `field`, with optional prefix, suffix, bounded fallback text, hide-when-empty behavior, and fixed text/date/number/integer/currency formatting. Display syntax such as `{{lunch.option_1}}` is editor shorthand that compiles to a typed field reference; it is not a template language and cannot execute code. The bound Data Source is referenced directly — it is **not** placed in the Layout — and its bounded cached dataset and date policy are projected to the Player once and shared.

## Date-aware structured content

Date-aware Data Sources store a mapped date field, a fixed or detected format, an IANA timezone, a selection mode (today, tomorrow, next available date, current week, custom range), whether past records are excluded, and explicit no-match behavior. The manifest carries the bounded dataset and policy once. The Player evaluates the active record locally, uses timezone calendar rules across DST, and reevaluates at startup and on local date changes, DST transitions, reboot, sleep recovery, timezone changes, and clock corrections — without requiring a new Layout, Widget revision, or manifest. It never assumes a day is 24 hours and never reuses yesterday's record unless `last_known_good` is explicitly configured. Studio can preview a Data Source with a selected date.

## Manifest and the Player

The Player manifest projects Widgets and Data Sources as separate arrays. Manifest v12 normalizes every Data Source into typed field definitions and bounded records, with cache state, optional date-selection policy, and optional attribution. The Player renders Widgets natively, shares one dataset across consumers, continues date-aware selection locally, and preserves offline playback. Players supporting v12 continue accepting cached v11 manifests.

Manifest v13 adds a stable declarative runtime boundary. Data Sources project provider-neutral scalar, record, time-series, list, or object datasets. Native Widgets compile to a closed, non-executable tree of layout, content, and bounded collection nodes. Website and YouTube Widgets compile to constrained web descriptors with explicit hosts, timeouts, fallback behavior, and lifecycle. The Player dispatches on presentation kind and node type rather than provider names.

Capability revision 2 implements native icons, downloaded Tilecast asset images, line/bar/donut charts, target progress, repeat indexes, numeric/date conditions, legends, bounded chart axes, and collection empty states. Remote images remain unsupported.

Provider creation remains limited to Tilecast releases. The Server embeds and validates one content-definition catalog and exposes it through `GET /api/v1/content-definitions`; the injected catalog is the single runtime source of truth for validation, compilation, dependency discovery, v13 requirement detection, manifest compilation, and fingerprint reconciliation. Studio does not maintain a second provider list for newly release-defined content. Supported generated controls are text, multiline text, number, integer, boolean, select, color, date, datetime, timezone, URL, Data Source, Data Source field, media asset, and bounded repeating group. Raw JSON, scripts, executable expressions, arbitrary HTML, uploaded definitions, and user-provided presentation trees are not exposed.

Startup validation of the catalog is conservative and bounded. It rejects duplicate output field keys, unsupported output field types, unknown capability names, capability versions below one, presentation nodes whose capability is not declared, unknown binding sources or condition operators, dataset bindings without a dataset reference, malformed node structure, excessive presentation depth or node count, empty repeating groups, contradictory numeric or string bounds, select defaults outside their options, required fields with empty defaults, and deprecation replacements that do not exist.

The database no longer enumerates providers. `widgets.provider` and `data_sources.provider` are constrained only by a bounded identifier shape (`^[a-z][a-z0-9_-]{0,79}$`); the application catalog decides which providers are supported and rejects unknown IDs before insertion. Adding a catalog definition therefore needs no schema migration. The TypeScript contract mirrors this: `WidgetProvider` and `DataSourceProvider` accept catalog-provided IDs while preserving the known legacy IDs, so a new definition needs no `api/types.ts` edit.

The School Status Source and School Status Banner are the reference implementation. The Source uses the registered generic `manual_object` Server adapter and emits a Data Document v1 object; that adapter validates configuration from the definition, converts configured values into the declared output fields, generates declared fields such as `updatedAt`, caches and previews the typed object, and projects it into Data Document v1 with no provider-specific lifecycle branches. The Banner resolves configuration placeholders on the Server and uses only existing `surface`, `column`, `badge`, `text`, and `conditional` nodes. Neither provider appears in Android production source. Studio renders both from catalog metadata (name, description, category, icon, and optional setup guidance) rather than provider-specific copy, and derives selectable fields directly from each Source definition's output schema.

New Data Source adapters that normalize to Data Document v1 and new native Widgets using existing declarative nodes therefore require only a catalog definition — no Android, TypeScript provider-union, Studio gallery, or database change. A new Android rendering primitive, presentation schema, or playback capability still requires a Player update.

Two narrow additions extend what a definition may express without weakening that boundary:

- A presentation template may reference a **derived configuration key** that manifest projection supplies rather than the author. Today the only one is `imageVariantId`, written from the author's `imageAssetId` media selection; the Image Notice Widget uses it. Derived keys are never accepted from a client and resolve to an empty value when projection produced none, so previewing a Widget before its image is projected does not fail the compile.
- A `repeat` node may declare an **offset**, so one Widget can feature the current record and list the ones that follow it. Now and Next uses an offset of one.

Studio draws a catalog preview for each Widget rather than an icon. The preview is inline SVG built from the definition's `thumbnail` name, follows the active theme, and needs no asset or network request. An unknown or missing name falls back to a generic preview, so a definition from a later release never breaks the gallery.

A Data Source that requires manifest v13 declares `requiresManifestV13` in its definition; the Server reads that metadata from the catalog rather than matching provider names. A Widget may reference more than one Data Source: every configuration field whose control is `data_source` is followed for manifest projection, usage tracking, deletion protection, assignment compatibility, and catalog invalidation.

Presentations containing only legacy Widget configurations continue using manifest v11. Saving a generalized data-driven Widget upgrades it to configuration version 2 and requires manifest v12. Studio refuses to assign v12 content to a screen or synchronized group until every target reports a compatible Player version.

The v13-compatible Player reports presentation schema versions, native capability identifiers and versions, web runtime version, and bundle size limits. The Server checks the exact requirements of every Widget and Data Source reachable from the assigned playlist, Layout text and visibility bindings, nested playlists, Layout dependencies, schedules, screen groups, and Takeover presentations. Assignment validation and manifest generation use the same requirements and the same catalog, so content that would fail manifest generation is rejected before assignment — including a presentation that reaches a v13-only Data Source through a Layout binding with no Widget. Compatibility errors name the screen where known, the Widget or Data Source, the missing schema or capability, and the required and reported versions, and never expose internal database IDs. Player-version checks remain only for Players that have not reported presentation capabilities; v11/v12 dual projection remains available for staged upgrades.

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

Studio uses `/api/v1/widgets` for Widgets and `/api/v1/data-sources` for Data Sources. There are no `/api/v1/apps` or `/api/v1/sources` aliases. `/assets` owns uploaded Media.

Studio navigation is organized by task rather than by record type. **Content** is one workspace whose tabs are Media (`/assets`), Widgets (`/widgets`), and Data (`/data-sources`); **Presentations** is one workspace whose tabs are Playlists (`/playlists`) and Layouts (`/layouts`). Those five routes remain canonical, so deep links, breadcrumbs, and search entries are unchanged; `/content` and `/presentations` redirect to the first tab of their workspace. The records themselves are unchanged — a Data Source is still a Data Source, and the "Data" tab label names the category, not the record type.
