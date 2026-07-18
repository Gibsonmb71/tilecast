# Tilecast Signal design system

Tilecast Signal is the shared visual language for Tilecast Studio and Tilecast
Player. It is calm, operational, compact, and accessible. It favors clear
hierarchy, borders, readable density, and explicit state over decoration.

This specification is for contributors designing or implementing Tilecast
interfaces. It records what is available today and the rules new work must
follow. It is not a component gallery, a marketing style guide, or permission
to present planned features as complete.

## System boundaries

Signal covers two related but separate interfaces:

| Surface         | Purpose                                        | Implementation source                                                                                    |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tilecast Studio | Browser-based management interface             | CSS tokens in `packages/design-tokens` and shared React primitives in `apps/dashboard/src/components/ui` |
| Tilecast Player | Fullscreen Android TV application              | Native Compose theme and components under `org.tilecast.player.ui.theme`                                 |
| Signage content | Organization-authored material shown by Player | Content, layout, and organization-branding settings; it does not redefine Studio                         |

Studio and Player share Signal's character, color intent, spacing rhythm, and
accessibility expectations. They do not share a rendering library. CSS is
authoritative for Studio; Compose is authoritative for Player.

Organization branding is content identity, not application chrome. An
organization accent or logo may appear in a preview, avatar, or small identity
detail. It never replaces Signal Blue in Studio navigation, actions, selected
states, links, or focus rings.

## Status of guidance

Use these labels when discussing the design system:

| Status            | Meaning                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Implemented**   | Available from shared tokens, React primitives, or the Player theme and safe to use now.                                      |
| **Normative**     | Required behavior for new or changed UI, even if enforcement is partly manual.                                                |
| **Page-specific** | Present in the product but not yet a shared pattern. Reuse its behavior cautiously; do not describe it as a system primitive. |
| **Planned**       | Proposed in the [Signal pattern roadmap](design-system-roadmap.md). It is not available until its status becomes Implemented. |

The roadmap is planning material. This document remains authoritative for
implemented and normative behavior.

## Principles

1. **Make state and action obvious.** Show what is happening, what changed, and
   the next safe action without requiring interpretation.
2. **Prefer useful density.** Fit operational information comfortably without
   oversized cards, decorative whitespace, or compressed touch targets.
3. **Use predictable patterns.** Prefer shared controls and familiar layouts to
   page-specific interaction inventions.
4. **Keep identity in its lane.** Tilecast application chrome remains Signal;
   organization branding belongs to signage and restrained identity details.
5. **Communicate beyond color.** Pair every status color with text and, where
   useful, an icon or dot.
6. **Preserve focus.** Keyboard and D-pad focus must always be visible, ordered,
   and recoverable.
7. **Show real system truth.** Do not fabricate analytics, storage totals,
   processing progress, compatibility, or feature availability.

Avoid gradients, glass effects, decorative motion, nested cards,
consumer-streaming patterns, hover-only operations, and a different icon for
every field.

## Foundations

### Token architecture

`packages/design-tokens/tokens.css` is Studio's public CSS import. It composes
the token layers in this order:

| Layer      | File             | Responsibility                                                   | Usage rule                                                 |
| ---------- | ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Primitive  | `colors.css`     | Neutral and chromatic color values                               | Use only while defining semantic or component tokens.      |
| Semantic   | `semantic.css`   | Canvas, surface, text, border, action, focus, and status meaning | Default choice for page and component styling.             |
| Typography | `typography.css` | Font families and text roles                                     | Use roles instead of recreating font shorthand values.     |
| Scale      | `spacing.css`    | Spacing, radii, and motion timing                                | Keep new work on the shared scale.                         |
| Component  | `components.css` | Sidebar, input, table, notice, and related roles                 | Use when the meaning is specific to that component family. |

Compatibility aliases such as `--tc-ink`, `--tc-surface`, and `--tc-brand`
exist while older page CSS moves to semantic names. New work uses the
`--tc-text-*`, `--tc-bg-*`, `--tc-action-*`, `--tc-border-*`, and
`--tc-status-*` families.

Raw color values belong only in token definitions, the native Player theme, or
dynamic previews of organization-controlled values. A page must not copy a hex
value from this document.

### Color

Signal Blue is the fixed interface action color. Broadcast Amber is a Tilecast
identity color used in the tall logo tile and restrained brand details; it is
not a warning color. Success, warning, danger, information, and neutral each
have separate foreground, background, and border roles.

#### Core identity and surfaces

| Role             | Light value | Dark value | Use                                                   |
| ---------------- | ----------- | ---------- | ----------------------------------------------------- |
| Canvas           | `#F6F8FA`   | `#0E141B`  | Application background                                |
| Surface          | `#FFFFFF`   | `#151D26`  | Panels and controls                                   |
| Subtle surface   | `#EEF2F5`   | `#202C38`  | Secondary grouping and table headers                  |
| Elevated surface | `#FFFFFF`   | `#1B2632`  | Menus, dialogs, and overlays                          |
| Primary text     | `#17212B`   | `#F5F7FA`  | Main copy and labels                                  |
| Secondary text   | `#667582`   | `#9EADB9`  | Supporting and metadata copy                          |
| Primary action   | `#3E6FE0`   | `#3E6FE0`  | Actions, links, selection, and focus-related emphasis |
| Broadcast Amber  | `#E9B44C`   | `#F4C15A`  | Tilecast identity only                                |

Values are references for review. Consume their semantic token, not the literal
value.

#### Studio control roles

| Token                 | Value                   | Use                                     |
| --------------------- | ----------------------- | --------------------------------------- |
| `--accent`            | `#3E6FE0`               | Primary actions, links, selected states |
| `--accent-hover`      | `#4D7CE6`               | Primary hover                           |
| `--accent-active`     | `#3563CF`               | Primary pressed state                   |
| `--control-border`    | `#2A3D5C`               | Secondary control border                |
| `--control-label`     | `#C6D4EA`               | Secondary control label                 |
| `--control-hover-bg`  | `#16223A`               | Secondary hover fill                    |
| `--field-bg`          | `#111D31`               | Input and search background             |
| `--field-border`      | `#24344E`               | Input and search border                 |
| `--field-placeholder` | `#66799A`               | Placeholder text                        |
| `--chip-bg`           | `#1A2942`               | Nested keycap and chip background       |
| `--chip-border`       | `#2A3D5C`               | Nested keycap and chip border           |
| `--chip-text`         | `#7F93B3`               | Nested keycap and chip text             |
| `--accent-focus-ring` | 25% alpha of `--accent` | Three-pixel keyboard-focus outer ring   |

#### Status roles

| Tone        | Meaning                                          | Typical examples                                      | Never use for                     |
| ----------- | ------------------------------------------------ | ----------------------------------------------------- | --------------------------------- |
| Success     | Completed, verified, healthy                     | Online, uploaded, saved                               | General positive decoration       |
| Information | Neutral guidance or active information           | Setup guidance, available detail                      | Primary actions                   |
| Warning     | Attention is needed but continuation may be safe | Stale data, partial compatibility                     | Broadcast Amber identity          |
| Danger      | Failure, revocation, or destructive consequence  | Failed processing, revoked player, validation failure | Routine cancellation              |
| Neutral     | Inactive, unknown, queued, or non-urgent         | Offline, pending, not configured                      | Disabled text without another cue |

Status assignments follow domain meaning. Do not infer a tone from an internal
enum name, and do not move server-owned screen status thresholds into Studio or
Player presentation code.

### Typography

Studio uses Inter with system fallbacks. Technical values use the shared
monospace family. Player uses the platform sans-serif family at TV scale.

#### Studio roles

| Role          | Token                     | Size / line height         | Use                                                |
| ------------- | ------------------------- | -------------------------- | -------------------------------------------------- |
| Page title    | `--tc-text-page-title`    | 24 / 30 px, semibold       | One title for the current route                    |
| Section title | `--tc-text-section-title` | 18 / 23.4 px, semibold     | Major section within a page                        |
| Panel title   | `--tc-text-panel-title`   | 15 / 20.25 px, semibold    | Bordered group or compact region                   |
| Body          | `--tc-text-body`          | 14 / 21 px                 | Default UI copy                                    |
| Label         | `--tc-text-label`         | 13 / 17.55 px, semibold    | Controls and compact headings                      |
| Supporting    | `--tc-text-supporting`    | 12 / 17.4 px               | Hints, metadata, and secondary context             |
| Technical     | `--tc-text-technical`     | 13 / 18.85 px, medium mono | IDs, versions, hashes, and machine-oriented values |

Use tabular numerals for counts, timestamps, durations, storage, versions, and
percentages when values align or update in place. Do not reduce essential
information to supporting text merely to make a layout fit.

#### Player roles

| Compose role     | Size / line height   | Typical use                       |
| ---------------- | -------------------- | --------------------------------- |
| `displayLarge`   | 52 / 60 sp           | Dominant pairing or state message |
| `headlineLarge`  | 40 / 48 sp           | Primary screen heading            |
| `headlineMedium` | 32 / 40 sp           | Secondary state heading           |
| `titleLarge`     | 24 / 32 sp           | Panel or step title               |
| `bodyLarge`      | 20 / 29 sp           | Main instructions                 |
| `bodyMedium`     | 17 / 25 sp           | Supporting detail                 |
| `labelLarge`     | 18 / 24 sp, semibold | Remote actions                    |

Player copy must remain legible at viewing distance. Do not transfer Studio's
compact type sizes to TV.

### Spacing, radius, and elevation

| Token           | Value | Common use                     |
| --------------- | ----- | ------------------------------ |
| `--tc-space-1`  | 4 px  | Tight internal separation      |
| `--tc-space-2`  | 8 px  | Icon-to-label and compact gaps |
| `--tc-space-3`  | 12 px | Control groups                 |
| `--tc-space-4`  | 16 px | Standard component padding     |
| `--tc-space-6`  | 24 px | Sections and page grids        |
| `--tc-space-8`  | 32 px | Major page separation          |
| `--tc-space-12` | 48 px | Large structural separation    |
| `--tc-space-16` | 64 px | Rare outer or TV spacing       |

| Control token         | Value | Use                          |
| --------------------- | ----- | ---------------------------- |
| `--control-height`    | 36 px | Standard buttons and fields  |
| `--control-height-sm` | 30 px | Compact controls             |
| `--control-height-lg` | 42 px | Explicit large controls      |
| `--control-radius`    | 8 px  | Buttons, inputs, and selects |
| `--chip-radius`       | 5 px  | Nested chips and keycaps     |

Controls use one 8 px radius. Chips, keycaps, and badges nested inside controls
use the 5 px chip radius. Panels remain 9 px and overlays remain 12 px. Buttons
must not use pill radii. Normal panels use borders; shadows are reserved for
overlays and drag states. Do not nest bordered panels when spacing, a heading,
or a divider can express the relationship.

Player reuses the 4–48 dp spacing rhythm, adds 72 dp horizontal and 52 dp
vertical screen insets, and keeps remote controls at least 52 dp high.

### Motion

| Token                  | Duration | Use                                    |
| ---------------------- | -------- | -------------------------------------- |
| `--tc-motion-fast`     | 120 ms   | Small hover or focus response          |
| `--tc-motion-standard` | 180 ms   | Normal state transition                |
| `--tc-motion-slow`     | 240 ms   | Larger but still restrained transition |

Motion explains a state change; it does not decorate idle UI. Honor the system
`prefers-reduced-motion` setting and the user's reduced-motion preference.
Loading indicators may rotate, but their accessible label must describe the
work rather than the animation.

### Themes and density

Studio supports light, dark, and system appearance through semantic tokens.
Components are not duplicated by theme. System appearance follows
`prefers-color-scheme`; explicit light or dark settings take precedence.

Studio also supports comfortable and compact density. Compact density reduces
selected layout spacing, not type legibility, control semantics, focus
visibility, or minimum practical targets. Density is a per-user preference and
must not alter stored domain data.

Whenever tokens or shared components change, verify inputs, notices, statuses,
tables, dialogs, disabled states, and focus rings in light and dark themes.

### Responsive layout

Signal does not currently expose shared breakpoint tokens. Existing pages use
content-driven, page-specific breakpoints. This is **Page-specific**, not a
license to copy arbitrary breakpoint values.

New work must:

- preserve the primary task without horizontal page scrolling;
- let tables scroll within a labeled or obvious container when columns cannot
  collapse safely;
- stack actions and field rows before labels or controls become cramped;
- keep important actions visible rather than hover-only;
- preserve document order, focus order, and readable line lengths; and
- provide a deliberate narrow-screen alternative for desktop editing surfaces.

## Studio components

Shared React primitives live in `apps/dashboard/src/components/ui`. Use them
before writing equivalent markup in a page. Their public props and rendered
semantics remain the source of truth.

### Component inventory

| Primitive                  | Implemented variants or behavior                                 | Use                                                |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `Button`                   | Primary, secondary, quiet, danger; compact and loading states    | Labeled actions                                    |
| `IconButton`               | Required accessible label and title                              | Compact familiar action with no visible label      |
| `Input`, `Textarea`        | Native form semantics                                            | Text and multiline entry                           |
| `Select`                   | Signal Select with keyboard menu and hidden native value control | Choosing one option from a closed set              |
| `Field`                    | Label, description, required indicator, error                    | Form control grouping                              |
| `Checkbox`                 | Native checkbox with visible label                               | Independent boolean choice                         |
| `Switch`                   | Native checkbox with switch semantics and optional description   | Immediate on/off setting                           |
| `RadioGroup`               | Fieldset and legend                                              | One choice from a small visible set                |
| `Panel`                    | Semantic section wrapper                                         | One genuinely separate concept                     |
| `SectionHeader`            | Title, description, actions                                      | Page section introduction                          |
| `PageHeader`               | Title, description, eyebrow, and actions                         | Consistent route and editor heading                |
| `Toolbar`                  | Toolbar role                                                     | Related high-frequency controls                    |
| `ViewTabs`                 | Current-view navigation, markers, Arrow/Home/End focus           | Switching route-backed or page-owned views         |
| `Pagination`               | Previous/next controls with optional status                      | Server- or cursor-paginated collections            |
| `ViewToggle`               | Grid/list selection                                              | Collection presentation choice                     |
| `ToggleGroup`              | One active option in a compact visible group                     | Short filters and display modes                    |
| `Notice`                   | Information, success, warning, danger, neutral                   | Contextual feedback with optional title and action |
| `StatusDot`, `StatusBadge` | Success, information, warning, danger, neutral                   | Compact textual status                             |
| `EmptyState`               | Title, message, optional action                                  | Valid collection or workspace with no content      |
| `Dialog`                   | Native modal dialog, title, close action, cancel handling        | Focused modal task                                 |
| `Drawer`                   | Modal detail surface, focus containment, responsive full width   | Browsing or editing contextual detail              |
| `TableContainer`           | Contained overflow                                               | Responsive data table boundary                     |
| `Skeleton`                 | Decorative loading placeholder                                   | Preserve approximate layout while loading          |
| `Spinner`                  | Labeled status                                                   | Indeterminate work                                 |

Popovers, ARIA tab panels, filter menus and chips, drop zones, inspectors,
timelines, and editor shells currently have page-specific implementations.
Their proposed shared forms are Planned, not Implemented. `ViewTabs` is
navigation between page-owned views; it does not claim ARIA `tab` or `tabpanel`
semantics.

### Primary navigation

Desktop navigation keeps the most frequently checked destinations stable and
uses static section labels rather than collapsible accordions:

- Overview and Screens remain first and ungrouped.
- Content contains Media, Widgets, and Data Sources.
- Compose contains Playlists, Layouts, and Schedules.
- Activity remains a standalone destination until multiple monitoring routes
  justify a real group.
- Settings stays in a separate footer region above the account controls.

Section labels describe information architecture; they are not interactive.
Compact desktop and mobile navigation hide the labels while preserving every
destination and the same route order. Do not add collapse state or hide a
primary route behind disclosure while the navigation remains this size.

### Persistent Studio header

Authenticated Studio routes use one persistent 56px utility header above page
content. It contains three stable regions:

- The left region renders breadcrumbs from the route hierarchy. A top-level
  route shows one semibold current-page label. Detail routes link muted
  ancestors and render the entity name as the unlinked current page. Page
  headings remain `h1` elements; breadcrumbs are navigation, not headings.
- The center region opens global search with `Command+K` on Apple platforms or
  `Control+K` elsewhere. The implemented search providers cover Studio route
  destinations, settings sections, and screen names. Additional entity
  providers may extend this registry without changing the palette interaction.
- The right region contains active-alert notifications, the role-gated Pair
  screen action, and the role-gated Create menu. Screen alerts link to screen
  details; failed Player update deployments link to Player update settings.

The header uses existing surface, border, text, status, focus, radius, spacing,
and button tokens. Below 900px, global search becomes an icon button and Pair
screen becomes icon-only; Create retains its label. Every icon-only control
requires an accessible name. The palette supports arrow-key selection, Enter
to navigate, and Escape to close. The global shortcut must not override text
entry inside a dialog.

### Buttons and actions

Use one primary action per local decision area. Secondary actions are bordered
alternatives; quiet actions reduce visual weight; danger actions communicate a
destructive consequence. Icon buttons are reserved for familiar actions where
space is constrained and always require an accessible label.

Default buttons are 36 px high and compact buttons are 30 px high. Loading
preserves the label's width, exposes busy state, and disables repeat activation.
Disabled controls use a not-allowed cursor, but a disabled state must not be the
only explanation of why an action is unavailable.

Primary buttons use the solid action accent with pure white text. Secondary
buttons use the shared control border and label tokens on a transparent fill;
hover changes only the shared secondary hover fill. Underlines belong to inline
text links, never button labels. Use at most one primary action per decision
region.

A destructive action remains visually restrained until the final confirmation.
The confirmation names the object and consequence. “Cancel” is not destructive
and does not receive danger styling.

### Forms and selection

Labels sit above controls. Supporting text follows the label; validation follows
the control. Required state must be available to assistive technology, not only
shown as an asterisk. Errors identify the problem and, when known, how to fix
it.

Controls use the shared 36 px height, 8 px radius, field background, border,
placeholder, disabled treatment, and focus tokens. Keyboard focus adds a 1 px
accent border and a 3 px soft outer ring. Use the control that matches the data:
Use the control that matches the data:

- checkbox for an independent choice;
- switch for an immediate enabled/disabled setting;
- radio group for a small set whose alternatives should remain visible;
- Signal Select for a longer closed set; and
- text input only when free entry is genuinely allowed.

Signal Select supports groups, disabled options, visible selection, Escape,
Arrow keys, Home, End, Enter, and Space. Its hidden native select preserves form
values and change-event compatibility; it is not the visible interaction
surface.

Settings translate bytes, durations, weekdays, enums, colors, and Android
package lists at the UI boundary without changing stored values.

### Status and feedback

Every status includes readable text. Use `StatusDot` for dense table or metadata
rows and `StatusBadge` when the state benefits from a contained label. Translate
raw internal values into user-facing language.

Use a Notice for feedback that belongs in the current context. Danger notices
use alert semantics; non-urgent variants use polite status semantics. Do not use
a warning notice as a permanent decorative panel.

Use an Empty State only when loading has completed successfully and the result
is genuinely empty. Loading, permission denial, network failure, and processing
failure are separate states. Skeletons preserve structure; spinners represent
indeterminate work. Neither replaces explanatory text when a wait may be long.

### Panels, tables, and dialogs

Panels group genuinely separate concepts. Within a panel, use spacing, headings,
rows, and dividers instead of one card per field.

Tables have no vertical rules, use a subtle header, keep rows approximately
44–52 px high, and contain their own horizontal overflow. Selected rows use the
soft action color. Row actions remain visually secondary and keyboard
accessible. A table must retain meaningful headers and must not become an
unlabeled grid of values on narrow screens.

Dialogs are for bounded tasks that require attention before returning to the
page. Give each dialog a specific title, a visible close action, Escape/cancel
behavior, and an unambiguous primary action. Do not layer dialogs. Large detail
browsing and persistent inspectors remain page-specific patterns until the
roadmap standardizes them.

### Icons and logos

Icons clarify familiar actions and states; they do not replace necessary text.
Use the existing Lucide icon vocabulary in Studio. Keep stroke weight and size
consistent within a control group. Do not assign a unique icon to every field or
use an unlabeled icon for an unfamiliar operation.

The Tilecast mark retains its three-tile proportions:

- tall left tile: Broadcast Amber;
- upper-right tile: Signal Blue; and
- lower-right tile: pale blue-gray.

Use the dark wordmark on light surfaces and the white wordmark on dark surfaces.
Do not redraw, distort, or recolor the mark per page.

## Player interface

Player is a fullscreen appliance interface, not a television version of
Studio. Its theme is dark, high-contrast, and intentionally small in scope.
Dynamic Material colors are disabled so device or launcher preferences cannot
change operational meaning.

Player supplies dark navy surfaces, TV typography, shared dimensions, logo
colors, and focus-aware filled and outlined buttons. Every remote action must:

- be reachable in a logical D-pad sequence;
- show a strong Signal Blue focus outline;
- retain at least a 52 dp control height;
- provide a small scale cue that remains stable at viewing distance; and
- remain operable without touch, mouse, or color perception.

Motion is restrained and state-driven. Focus must not cause surrounding layout
to jump. Normal Player UI never displays raw exceptions, internal IDs, debug
JSON, credentials, or development placeholders.

Organization-controlled Player background, text, logo, fallback messages, and
footer use validated settings with safe Tilecast defaults. Organization colors
must not weaken emergency readability, remote focus, or system-state contrast.

## Content and language

Tilecast speaks plainly and operationally. Prefer short sentences, concrete
nouns, active verbs, and the terminology already used by the product.

| Context                 | Rule                                                          | Example                                        |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Page and section titles | Name the object or task; use sentence case                    | “Player updates”                               |
| Buttons                 | Start with a specific verb; name the result when useful       | “Pair screen”, “Save changes”                  |
| Labels                  | Name the value, not an instruction to the user                | “Server address”                               |
| Supporting text         | Explain consequence, format, or scope                         | “Applies after the player reconnects.”         |
| Status                  | Translate internal state into concise human language          | “Waiting” instead of `queued`                  |
| Error                   | State what failed and the next useful action                  | “Upload failed. Check the file and try again.” |
| Confirmation            | Name the affected object and irreversible consequence         | “Revoke Lobby display credential?”             |
| Empty state             | Explain why the area is empty and offer the next valid action | “No screens are paired.”                       |
| Loading                 | Name the object or operation                                  | “Loading player status…”                       |

Do not use “Are you sure?” without naming the consequence. Avoid “successfully”
when the completed action is already clear. Do not blame the user, expose stack
traces, or turn a server error code into visible copy.

Format dates and times with the user's locale and include timezone context when
the schedule or event can be ambiguous. Present durations and storage in human
units while preserving exact values where operationally useful. Versions and
technical identifiers use technical typography. Secrets, full credentials,
poll tokens, and enrollment tokens must never appear in UI copy, examples,
screenshots, or logs.

## Accessibility

WCAG AA is the minimum contrast target for normal text and controls. In
addition:

- keep keyboard and D-pad focus visible at all times;
- preserve logical document, reading, and focus order;
- associate labels, descriptions, validation, and switch state semantically;
- pair status color with text and an icon or dot;
- honor reduced-motion preferences;
- keep Studio touch targets near 44 px and Player controls at least 52 dp high;
- supply accessible names for icon-only controls;
- announce urgent errors assertively and routine updates politely;
- avoid organization colors where they could weaken Studio or emergency
  readability; and
- verify zoom, narrow screens, text expansion, and contained overflow.

Accessibility behavior is part of a component's contract, not a final review
step.

## Contributor checklists

### New or changed Studio UI

- [ ] Uses semantic or component tokens instead of raw values.
- [ ] Uses shared React primitives where an implemented primitive exists.
- [ ] Does not describe a Planned or Page-specific pattern as shared.
- [ ] Shows loading, empty, error, disabled, and success states that can actually
      occur.
- [ ] Keeps the primary action clear and destructive consequences explicit.
- [ ] Works in light, dark, and system appearance.
- [ ] Works in comfortable and compact density.
- [ ] Preserves keyboard access, visible focus, labels, and announcements.
- [ ] Adapts deliberately to narrow screens and contains table overflow.
- [ ] Respects reduced motion and avoids hover-only operations.
- [ ] Uses real product state and does not fabricate future capability.

### New or changed Player UI

- [ ] Uses the native Signal theme rather than copied Studio CSS values.
- [ ] Works entirely with D-pad focus and remote activation.
- [ ] Keeps controls at least 52 dp high with a visible focus outline.
- [ ] Remains legible at TV viewing distance and does not use Studio-scale type.
- [ ] Preserves state-machine truth and does not expose raw diagnostics or
      credentials.
- [ ] Uses organization branding only through validated Player settings.
- [ ] Has a safe narrow/overscan layout and restrained state-driven motion.
- [ ] Is verified on the supported emulator or device when behavior depends on
      focus, launcher, WebView, or platform rendering.

### Review before merging

- [ ] Token, component, and terminology claims match their source files.
- [ ] Status meaning is not encoded by color alone.
- [ ] Automated formatting, lint, and relevant tests pass.
- [ ] Visual review covers themes, density, responsive layout, and focus.
- [ ] Documentation is updated with the implementation and does not promise
      unfinished work.

## Correct and incorrect use

**Correct:** a white or navy bordered panel with one section heading, compact
rows, a blue primary action, an inline textual status, and a clear narrow-screen
layout.

**Incorrect:** one rounded card per field, a gradient header, amber warnings,
organization-colored focus rings, unlabeled icon actions, fabricated metrics,
or a subtle TV focus state that disappears at viewing distance.
