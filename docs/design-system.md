# Tilecast Signal design system

Tilecast Signal is the shared visual language for Tilecast Studio and Tilecast Player. It is calm, operational, compact, and accessible. It favors clear hierarchy, borders, readable density, and explicit state over decoration.

## Principles

- Make current state and the next safe action obvious.
- Prefer useful density to oversized cards or empty space.
- Use established controls and predictable layout patterns.
- Keep organization branding separate from the Tilecast interface.
- Never communicate status with color alone.
- Preserve keyboard and D-pad focus at all times.

Avoid gradients, glass effects, decorative motion, nested cards, consumer-streaming patterns, and a different icon for every field.

## Token architecture

`packages/design-tokens` is authoritative for Studio. `tokens.css` preserves the public import and composes:

- `colors.css`: neutral, blue, amber, green, orange, red, and information primitives.
- `semantic.css`: canvas, surfaces, text, borders, actions, focus, and status meanings for light and dark themes.
- `typography.css`: Inter and technical monospace roles.
- `spacing.css`: the 4 px spacing scale, radii, and motion timing.
- `components.css`: sidebar, button, input, table, notice, and compatibility tokens.

Pages consume semantic or component tokens. Raw colors belong only in the token source or dynamic player-branding previews.

## Palette

Signal Blue is the fixed Tilecast interface action color. Broadcast Amber is an identity color used in the tall logo tile and restrained brand details; it is not the warning color. Success, warning, danger, information, and neutral states have separate foreground, background, and border tokens.

The light canvas is `#F6F8FA` with white surfaces. The dark canvas is `#0E141B` with navy surfaces. Both themes use blue-gray secondary text and distinct strong borders.

## Logo

The mark retains the original three-tile proportions:

- tall left tile: Broadcast Amber;
- upper-right tile: Signal Blue;
- lower-right tile: pale blue-gray.

Use the dark wordmark on light surfaces and the white wordmark on dark surfaces. Do not redraw or recolor the mark per page.

## Typography

Studio uses Inter at 14 px for body copy, 24 px page titles, 18 px section titles, 15 px panel titles, 13 px control labels, and 12 px supporting text. Technical values use the shared monospace token. Counts, time, storage, versions, and percentages use tabular numerals.

Player typography remains TV-scale: primary states are 40–52 px, body copy is 17–20 px, and remote actions use an 18 px semibold label.

## Spacing, radius, and elevation

Use the 4, 8, 12, 16, 24, 32, 48, and 64 px spacing tokens. Controls use a 6 px radius, panels 9 px, overlays 12 px, and status/filter pills only use the pill radius. Normal panels use borders. Shadows are reserved for overlays and drag states.

## Buttons and forms

Buttons are primary, secondary, quiet, danger, or icon actions. Default height is 40 px; compact actions are 32 px. Danger is outlined until the final destructive confirmation. Loading indicators preserve label width. Disabled controls use a not-allowed cursor.

Labels sit above controls, supporting text follows the label, and validation follows the control. Controls use shared 40 px sizing, focus rings, disabled treatment, and semantic switches. Settings translate bytes, durations, weekdays, enums, colors, and Android package lists at the UI boundary without changing stored values.

Studio option controls use the shared Signal Select rather than a browser-rendered menu. Its trigger remains at least 40 px tall, menus use the elevated Signal surface, and options support groups, disabled states, visible selection, Escape, arrows, Home, End, Enter, and Space. The hidden native select preserves form values and change-event compatibility; it is not the visible interaction surface.

## Statuses and notices

Status presentation always includes text and a dot or icon. Compact badges are appropriate for verified, failed, scheduled, or updating states; inline dot labels are preferred in dense tables. Never display raw internal state names.

Notices support information, success, warning, danger, and neutral variants. Use `role="alert"` for urgent errors and a polite status role for non-urgent updates.

## Tables and panels

Tables have no vertical rules, a subtle header, 44–52 px rows, contained horizontal scrolling, and a blue-soft selected state. Actions remain visually secondary. Panels group genuinely separate concepts; field rows should use spacing and dividers instead of nested cards.

## Dark mode

Light, dark, and system preferences switch semantic tokens. Components are not duplicated by theme. Verify inputs, notices, statuses, tables, dialogs, disabled states, and focus rings whenever tokens change.

## Organization branding

Organization accent color may appear in an organization avatar, branding preview, or small identity detail. It never replaces Signal Blue in Studio navigation, buttons, links, selected states, or focus rings. Player background, text, logo, fallback messages, and footer remain organization-configurable with safe Tilecast defaults.

## Android TV

The player theme lives under `org.tilecast.player.ui.theme`. It supplies the dark navy palette, TV typography, dimensions, logo colors, and focus-aware buttons. Every remote action receives a strong Signal Blue outline and a small scale/elevation cue. Dynamic Material colors are disabled. Motion is restrained and state-driven.

## Accessibility

- Maintain WCAG AA contrast for normal text and controls.
- Keep visible keyboard and D-pad focus.
- Provide labels, descriptions, validation associations, and semantic switch state.
- Pair status color with text and an icon or dot.
- Respect reduced-motion preferences.
- Keep touch targets near 44 px and TV controls at least 52 px high.
- Do not use organization colors where they could weaken Studio or emergency readability.

## Correct and incorrect use

Correct: a white bordered panel with one section heading, compact rows, a blue primary action, and an inline success dot.

Incorrect: one rounded card per field, a gradient header, amber warnings, organization-colored focus rings, unlabeled icon actions, or a subtle TV focus state that disappears at viewing distance.
