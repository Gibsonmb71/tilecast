# Tilecast architecture through Milestone 3

Tilecast begins as a modular monolith. The server compiles into one Go binary, serves the versioned REST API, applies embedded SQL migrations at startup, and serves the compiled dashboard. PostgreSQL is the source of truth. This keeps a small self-hosted installation understandable while preserving clean package boundaries for later player and media work.

## Boundaries

- `cmd/tilecast` owns process startup and graceful shutdown.
- `internal/config` validates environment configuration.
- `internal/database` owns the connection pool and Goose migrations.
- `internal/auth` owns password hashing, first-owner setup, users, and opaque sessions.
- `internal/httpapi` translates versioned HTTP contracts to application operations. Database rows are not serialized directly.
- `internal/media` owns resumable upload state, generated storage keys, local storage, trusted inspection, compatibility decisions, persistent jobs, and delivery metadata.
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

The `devices` server package owns installation identity, pairing sessions, enrollment, device authentication, screen administration, and status calculation. Pairing codes, poll secrets, enrollment tokens, and device credentials have distinct purposes. Active WebSocket membership is kept in a process-local presence hub and is the strongest online signal; PostgreSQL timestamps provide recent, stale, and offline status after a restart.

Media files use a provider interface with a local backend under `/data/media`. PostgreSQL owns asset, variant, upload, and job state; the filesystem stores bytes only under generated identifiers. Upload finalization hashes and identifies content before an asset is created. Workers claim durable jobs with PostgreSQL row locking and skip-locked semantics, so jobs survive restarts and multiple processes do not execute one claim concurrently.

FFprobe extracts trusted video metadata. FFmpeg is invoked directly, never through a shell, with local-file protocol restrictions, timeouts, metadata stripping, bounded worker concurrency, and generated input/output paths. Derivatives are written to temporary files and atomically promoted. The first compatibility profile is MP4/H.264/yuv420p/AAC-LC at no more than 1920×1080 and 60 fps, with fast-start and normalized rotation. Compatible originals are reused; otherwise Tilecast remuxes when possible and transcodes only when necessary.

Player manifests, content rendering, playlists, layouts, scheduling, Android downloading, and playback remain deliberately deferred.
