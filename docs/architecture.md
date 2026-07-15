# Tilecast architecture through Milestone 4

Tilecast begins as a modular monolith. The server compiles into one Go binary, serves the versioned REST API, applies embedded SQL migrations at startup, and serves the compiled dashboard. PostgreSQL is the source of truth. This keeps a small self-hosted installation understandable while preserving clean package boundaries for later player and media work.

## Boundaries

- `cmd/tilecast` owns process startup and graceful shutdown.
- `internal/config` validates environment configuration.
- `internal/database` owns the connection pool and Goose migrations.
- `internal/auth` owns password hashing, first-owner setup, users, and opaque sessions.
- `internal/httpapi` translates versioned HTTP contracts to application operations. Database rows are not serialized directly.
- `internal/media` owns resumable upload state, generated storage keys, local storage, trusted inspection, compatibility decisions, persistent jobs, and delivery metadata.
- `internal/playlists` owns ordered playlists, direct assignments, per-screen manifest versions, manifest contracts, and summarized synchronization status.
- `internal/web` serves immutable dashboard assets and the SPA fallback.
- `apps/dashboard/src/api` owns browser API types and transport behavior.
- `packages/*-schema` are reserved for stable, versioned cross-application contracts as those protocols are introduced.

## Authentication model

The first successful setup request acquires a PostgreSQL advisory transaction lock, creates the single organization and owner, records an audit event, and issues a session atomically. Passwords use Argon2id with a unique random salt. The browser receives a random opaque session token in an HttpOnly, SameSite=Strict cookie; PostgreSQL stores only its SHA-256 hash. Authenticated state-changing requests also require a session-specific CSRF token.

Sessions are revocable database records rather than self-contained tokens. This is intentionally compatible with later user deactivation and administrative session revocation. OIDC may be added behind the authentication boundary without changing resource APIs.

## Database evolution

Goose migrations are embedded in the binary and run before the connection pool is opened to serve traffic. Applied versions are recorded by Goose. Migrations must be forward-safe; deployed player manifest schemas will follow separate compatibility rules once introduced.

## Dashboard delivery

During development Vite runs separately and proxies `/api` to the server. The container build compiles the dashboard first and embeds the resulting hashed assets into the Go server, leaving one application process to deploy.

## Deferred decisions

The player is a native Kotlin/Compose application. Room stores the durable player-generated ID, selected server identity, and paired screen identifiers. Android Keystore protects the device credential. WorkManager provides a low-frequency heartbeat fallback; foreground WebSocket presence is managed by the application and is not delegated to WorkManager.

The `devices` server package owns installation identity, pairing sessions, enrollment, credential replacement, screen administration, and status calculation. Pairing codes, poll secrets, enrollment tokens, and device credentials have distinct purposes. A stable player installation ID maps recovery requests back to the original screen; explicit repair approval is stored on the session, while previous credentials are revoked only in the successful enrollment transaction. Active WebSocket membership is kept in a process-local presence hub and is the strongest online signal; PostgreSQL timestamps provide recent, stale, and offline status after a restart.

Media files use a provider interface with a local backend under `/data/media`. PostgreSQL owns asset, variant, upload, and job state; the filesystem stores bytes only under generated identifiers. Upload finalization hashes and identifies content before an asset is created. Workers claim durable jobs with PostgreSQL row locking and skip-locked semantics, so jobs survive restarts and multiple processes do not execute one claim concurrently.

FFprobe extracts trusted video metadata. FFmpeg is invoked directly, never through a shell, with local-file protocol restrictions, timeouts, metadata stripping, bounded worker concurrency, and generated input/output paths. Derivatives are written to temporary files and atomically promoted. The first compatibility profile is MP4/H.264/yuv420p/AAC-LC at no more than 1920×1080 and 60 fps, with fast-start and normalized rotation. Compatible originals are reused; otherwise Tilecast remuxes when possible and transcodes only when necessary.

Manifest versions are persisted per screen and advance only when its assignment or playback-relevant playlist revision changes. Reads are idempotent and use stable ETags. WebSockets carry only `manifest.changed`; players periodically reconcile as a fallback.

Android Room stores pending, ready, active, failed, and superseded manifests plus cache metadata. A pending manifest activates only after every required file is size-checked, SHA-256 verified, and atomically renamed. The prior active manifest remains untouched during preparation, and startup loads verified active content before attempting the network.

Playback is one fullscreen zone with sequential looping, image timers, Media3 video, fit/audio/offset settings, bounded failure skipping, and safe fallback states. Multi-zone layouts, compositions, schedules, and advanced commands remain deferred.

## Scheduling and sync groups

Sync groups own synchronized fallback content and schedule targeting. A screen belongs to zero or one group; PostgreSQL enforces the invariant with a unique membership constraint. Assigning content through any member updates the group assignment, and a schedule aimed at a grouped screen is normalized to the group target. Ungrouped screens keep independent assignments and schedules. `internal/scheduling` remains the server authority for half-open interval evaluation and deterministic precedence: priority, later effective start, then stable ID. The Android `ScheduleEngine` implements the same transport semantics for offline evaluation.

Player manifest v6 contains only schedules relevant to the authenticated screen, its fallback, required playlists and variants, server time, preparation policy, and optional sync-group playback epoch. Group members calculate the same current item and elapsed offset from the shared clock, including after reconnecting late. Recurring rules use calendar calculations rather than fixed-duration days. A repeated local time uses the earlier occurrence for a start and later occurrence for an end; a nonexistent local time advances to the first valid time after the DST gap.

## Milestone 6 website playback

Website configuration is normalized in `website_assets`; no page data or credentials are stored. Manifest v3 includes only websites referenced by relevant playlists, plus optional fallback-image variants. The Android player isolates WebView policy, lifecycle, timeout/reload control, failure state, and data clearing from Compose playlist orchestration. Scheduling is unchanged.

The server validates URLs without fetching them, avoiding SSRF and network-topology assumptions. Top-level navigation uses an exact-host allowlist on the player. Subresource filtering is intentionally not claimed because Milestone 6 does not install a request-interception proxy.

## Sources

Sources are reusable dynamic Content items. The `sources` table stores a built-in provider name, a provider configuration version, and a validated JSON object; clients cannot invent provider names or arbitrary keys. Provider implementations own normalization, validation, manifest projection, Studio editing, and player rendering. Website is migrated into the Source model while retaining the existing website validation and WebView renderer. YouTube has a dedicated IFrame API renderer and does not pass through the generic Website renderer.

Manifest v5 contains only Sources referenced by playlists relevant to the authenticated screen. Source items use stream delivery; fallback images continue through the verified media-variant preparation path. The provider boundary is internal—Tilecast does not load third-party provider code or expose a marketplace.

## Milestone 7 operations

Emergency takeovers are separate lifecycle records rather than schedules. Manifest v4 references an emergency playlist and expiration only for affected screens. Persistent typed player commands use PostgreSQL as the delivery source of truth; WebSockets only announce availability. See [emergency-and-operations.md](emergency-and-operations.md).

## Milestone 8 settings architecture

The closed typed registry separates organization settings, preferences, group policy, and screen policy. Effective player policy uses screen, group priority plus stable UUID, organization, then built-in precedence. A separate ETag-enabled player configuration document changes policy and branding without revising content manifests. See [settings.md](settings.md).

## Milestone 10 Android reliability

`CommissioningController`, `ActiveHoursEngine`, `ReliabilitySupervisor`, `ReliabilityController`, and the accessibility return policy are independent of Compose playback UI. Boot recovery restores cached state and uses bounded launch retries. Watchdog escalation persists crash history, executes each recovery rung, and enters safe mode without deleting configuration. Managed Kiosk is capability-confirmed through Android device policy and lock task. Accessibility Control observes only foreground package transitions and applies a fixed excluded-package policy. Power Assist selects device-policy sleep, accessibility lock, or black-screen fallback; it never sends direct HDMI-CEC commands. Studio stores human-confirmed physical-TV results separately from player-reported Android capability and shows a computed Zero-Touch Readiness panel. See [reliability-and-power.md](reliability-and-power.md).

## Milestone 9 player updates

The `updates` domain owns an optional fixed GitHub Releases provider, direct signed-release import, Ed25519-signed release manifests, Android APK-signature verification, private persistent cache, deployment snapshots, and per-screen state. Both release sources converge on one verified Player release model. Update commands reuse PostgreSQL command delivery; APK bytes use a device-authenticated range endpoint and never enter content manifests. Success remains provisional until the updated player reconnects with the expected version code. See [player-updates.md](player-updates.md).
