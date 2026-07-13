# Settings and player policies

Tilecast separates deployment configuration, organization settings, group policies, screen overrides, and user preferences. Deployment values remain environment-controlled and secret values or sensitive paths are never returned by the API.

The typed registry in `apps/server/internal/settings/registry.go` is closed: every key has a stable name, scope, type, default, validation, application timing, and documentation metadata. Unknown keys and keys used at the wrong scope are rejected. Runtime values remain bounded by deployment hard limits.

## Policy precedence

Effective player values resolve in this order:

1. Screen override.
2. Highest-priority matching group policy.
3. Organization player default.
4. Built-in Tilecast default.

Equal-priority groups use ascending stable group UUID ordering. Update timestamps never affect precedence. Studio’s effective-policy view shows every value and source plus organization, group, screen, and final configuration revisions.

## Player configuration

`GET /api/v1/player/config` is device-authenticated and independent of content manifests. Schema v1 has a monotonic per-screen revision and stable ETag. It contains effective branding, playback, cache, synchronization, website, reliability, power, Managed Kiosk, and accessibility policy only—never inheritance metadata, credentials, unrelated groups, or deployment paths.

Reliability, power, and accessibility keys are policy-scoped and follow the same screen/group/organization/built-in inheritance. Requested values and effective Android capabilities are distinct: for example, `reliability.mode=managed_kiosk` remains effectively `standard` until Android confirms active lock task. Active-hour local times and IANA timezone identifiers are validated; package allowlists accept only bounded Android application IDs. See [reliability and power](reliability-and-power.md).

Players preserve the current and previous valid configuration in Room, validate before activation, reconcile periodically, and react to lightweight `config.changed` notifications. Item-specific playlist settings continue to win over player defaults. Invalid configuration preserves the previous valid revision and reports a safe error.

## Import, export, and maintenance

Owner exports contain schema version, timestamp, Tilecast version, organization settings, and group policy metadata. They exclude passwords, sessions, device credentials, connection strings, signing keys, website state, media files, and user preferences. Import requires validation, preview, confirmation, revision checking, and audit.

Retention values are typed and bounded. Maintenance routes are fixed actions; they cannot execute shell commands, SQL supplied by users, restart services, or install software.
