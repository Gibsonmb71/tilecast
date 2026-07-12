# Development

Use `make bootstrap` after installing Go 1.24+, Node.js 22+, npm, and Docker. PostgreSQL is the only runtime dependency for Milestone 1.

The normal loop runs `make dev-server` and `make dev-dashboard` in separate terminals. Server changes require a restart; Vite handles dashboard updates. `make check` runs dashboard formatting checks, lint, unit tests, Go vet, and Go tests. `make build` creates the dashboard bundle, copies it into the server embed directory, and compiles the single binary.

Android player requirements and commands are documented in [`android-development.md`](android-development.md).

## Migration changes

Add sequential Goose SQL files under `apps/server/internal/database/migrations`. Every migration needs `-- +goose Up` and a working `-- +goose Down` section. Startup applies pending migrations automatically. Never edit an applied migration after a release; add another migration.

## Integration database

Local tests are unit tests and do not mutate a database. The container smoke check builds the actual image, starts PostgreSQL, applies migrations, and exercises the first-owner flow. CI performs the compilation and unit checks on every change.
