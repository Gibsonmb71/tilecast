# Display Groups

Tilecast calls the synchronized screen collection a **Display Group** in
Studio. The existing `screen_groups`, `screen_group_memberships`, schedule
targets, assignment tables, and player manifest fields remain in place for
API and database compatibility.

## Modes

Every Display Group has a `displayMode`:

- **Mirror** — the existing behavior. Members share the assignment, schedule
  target, playback epoch, and current playback position.
- **Span** — a single logical canvas rendered across multiple displays. Span
  geometry and panel preparation are documented with the Span implementation.

The migration adds `screen_groups.display_mode` with a default of `mirror`, so
all existing groups are explicitly Mirror groups without changing their
playback behavior. A screen still belongs to zero or one Display Group.

The `/screen-groups` API paths and legacy `syncGroupId` screen fields remain
valid. New group responses include `displayMode`; clients that talk to an older
server should treat a missing value as `mirror`.
