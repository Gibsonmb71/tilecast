# Tilecast

**Open signage, built to stay on.**

Tilecast is an open-source, self-hosted digital signage platform for organizations that want to operate their own signage server. It is designed for reliable playback on Fire TV, Google TV, and Android TV devices without requiring a paid cloud service.

This repository implements **Milestone 7: Emergency takeover and operational screen controls**. Tilecast Studio can temporarily override normal fullscreen playback on selected screens or groups, track restoration state, and deliver persisted typed commands for synchronization, playback reload, screen identification, protected cache cleanup, website-data cleanup, and playback enable/disable. Website authentication, multi-zone layouts, compositions, PDF playback, device reboot, arbitrary execution, and proof-of-play remain out of scope.

## Quick start with Docker Compose

Requirements: Docker Engine with Docker Compose v2.

```sh
cp deploy/docker/.env.example deploy/docker/.env
```

Edit `deploy/docker/.env` and replace `POSTGRES_PASSWORD`. For a local HTTP installation, leave `TILECAST_COOKIE_SECURE=false`. Then start Tilecast:

```sh
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yml up -d --build
```

Open [http://localhost:8080](http://localhost:8080), enter the organization details, and create the first owner account. Database migrations run automatically before the HTTP server starts.

Check the installation with:

```sh
curl http://localhost:8080/healthz
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yml ps
```

## Development

Requirements:

- Go 1.24 or later
- Node.js 22 or later and npm
- Docker (for PostgreSQL)

```sh
cp deploy/docker/.env.example deploy/docker/.env
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yml up -d postgres
npm install
cd apps/server && go mod download && cd ../..
```

Set a local server environment:

```sh
export TILECAST_DATABASE_URL='postgres://tilecast:replace-with-a-long-random-password@localhost:5432/tilecast?sslmode=disable'
export TILECAST_COOKIE_SECURE=false
```

Run the API and dashboard in separate terminals:

```sh
make dev-server
make dev-dashboard
```

The Vite dashboard is at `http://localhost:5173` and proxies API requests to the Go server at port 8080.

Useful checks:

```sh
make format
make check
make build
```

## Production notes

- Put Tilecast behind an HTTPS reverse proxy or use the optional Cloudflare Tunnel profile.
- Set `TILECAST_PUBLIC_URL` to the externally reachable HTTPS URL and `TILECAST_COOKIE_SECURE=true`.
- Keep PostgreSQL and the Tilecast data volume on persistent storage.
- Back up both volumes. PostgreSQL and `/data/media` are both required for a complete Milestone 3 backup; automated backup/restore tooling remains scheduled for Milestone 9.
- Never commit `.env` or a Tunnel token.

See [deployment documentation](docs/deployment.md), [architecture](docs/architecture.md), [API documentation](docs/api.md), and [development setup](docs/development.md).

## Android TV player

Build the sideloadable debug APK with:

```sh
cd apps/player-android
./gradlew assembleDebug
```

The APK is written to `apps/player-android/app/build/outputs/apk/debug/app-debug.apk`. Release builds are unsigned unless a signing configuration is supplied outside the repository. See [Android development](docs/android-development.md), [Fire TV sideloading](docs/fire-tv.md), and [Google TV testing](docs/google-tv.md).

## Repository map

```text
apps/server/          Go server and embedded dashboard
apps/dashboard/       React and TypeScript management UI
apps/player-android/  Native Fire TV, Google TV, and Android TV player
packages/             Versioned public schemas and design tokens
deploy/               Docker, optional Tunnel, and deployment examples
docs/                 Architecture, API, protocol, and operations documentation
```

## License

Tilecast is licensed under the [GNU Affero General Public License v3.0](LICENSE). Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first.
