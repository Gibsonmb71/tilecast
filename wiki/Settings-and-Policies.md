# Settings and Policies

Tilecast settings are typed, validated, versioned, and divided by scope.

## Settings areas

Studio organizes Settings into:

### Organization

- General
- Branding
- Users

### Content and playback

- Playback
- Media
- Websites
- Scheduling

### Player management

- Reliability and kiosk
- Active hours and power
- Accessibility control
- Player updates

### Operations

- Emergency and commands
- Data retention
- System
- Import and export

### Personal

- My preferences

## Scope

Tilecast separates:

1. Deployment configuration
2. Organization settings
3. Group player policy
4. Screen player overrides
5. User preferences

Deployment configuration stays in environment variables. Studio cannot reveal or edit database URLs, signing keys, tunnel tokens, secret values, storage roots, or hard security limits.

## Player policy precedence

For each player-policy key:

1. Screen override
2. Highest-priority matching group
3. Organization default
4. Built-in Tilecast default

Equal-priority groups are resolved by stable group identity, not by update time.

Use the screen's effective-policy view to see the winning value and its source.

## What policy can control

Player configuration is independent of the content manifest and can include:

- branding
- playback defaults
- cache behavior
- synchronization intervals
- website defaults
- reliability mode
- active hours
- power behavior
- Managed Kiosk request
- Accessibility Control request

A playlist item's own setting still overrides the relevant player default.

## Requested policy versus capability

A policy request does not grant an Android permission.

Examples:

- Managed Kiosk remains effectively Standard until lock task is confirmed.
- Accessibility Control remains unavailable until enabled on the TV.
- Power Assist may fall back to black screen if device sleep is unavailable.
- Boot launch may remain limited by firmware.

Studio reports requested and effective states separately.

## Branding

Branding controls the player's fallback presentation, including:

- background and text colors
- no-content title
- no-content message
- footer text

Emergency takeover keeps Tilecast's fixed high-contrast treatment instead of custom fallback branding.

## User preferences

Preferences affect only the signed-in Studio account. Current preferences include appearance, interface density, and reduced motion.

## Import and export

Owner exports contain portable, non-secret configuration such as:

- schema version
- export timestamp
- Tilecast version
- organization settings
- group policy metadata

Exports exclude:

- passwords and sessions
- player credentials
- database connection strings
- signing keys
- media files
- website browser state
- user preferences

Import requires validation, preview, confirmation, and revision checking.

## Revision conflicts

Settings use optimistic concurrency. If another administrator saves changes first, Studio asks you to reload instead of silently overwriting the newer revision.
