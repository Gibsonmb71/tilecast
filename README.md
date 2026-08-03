<h1 align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset=".github/logos/tilecast-logo-white.svg"
    >
    <source
      media="(prefers-color-scheme: light)"
      srcset=".github/logos/tilecast-logo-black.svg"
    >
    <img
      alt="Tilecast"
      src=".github/logos/tilecast-logo-black.svg"
      width="300"
    >
  </picture>
</h1>

<p align="center">
  <strong>Open signage, built to stay on.</strong>
</p>
Tilecast is an open-source, self-hosted digital signage platform for organizations that want to operate their own signage server. It is designed for reliable playback on Fire TV, Google TV, Android TV, and Linux signage computers without requiring a paid cloud service.

The Content library is organized into **Media** (uploaded images and videos), **Widgets** (reusable visual content), and **Data Sources** (reusable data connections). Media supports folders, collections, multiple tags, availability dates, and expiration; playlists can use a manual timeline or populate themselves from any/all selected media tags. Standalone Website, YouTube, Clock, Date, QR Code, and Countdown Widgets cover common signage needs. Ticker, Menu / Price Board, List, Table, Agenda, Metric, Cards, and Weather Widgets display a compatible Data Source. Calendar, RSS, Atom, JSON, CSV, Manual Table, and Weather Data Sources handle acquisition, typed fields, caching, and date-aware selection independently from presentation. Widgets and Media can be reused in playlists and Layouts. See [Widgets, Data Sources, and Layouts](docs/widgets-and-layouts.md).

Tilecast Player includes hardened first-run commissioning, cached boot recovery, persistent watchdog escalation, safe mode, remote management, and offline playback. Android players add capability-confirmed Managed Kiosk, locally approved Accessibility Control Assist, and best-effort platform sleep/wake behavior; Android Power Assist does not send raw HDMI-CEC commands. Linux players use a kiosk session and systemd for unattended startup and recovery, and can expose capability-gated HDMI-CEC/DDC/CI Display Control when the host tools and device permissions are available. See [Display Control](docs/display-control.md), [Android reliability and power](docs/reliability-and-power.md), and the wiki's [Reliability and Kiosk](https://github.com/Gibsonmb71/tilecast/wiki/Reliability-and-Kiosk) guide, which covers both Android and Linux.

Player pairing recovery supports an upgraded device that keeps its stable installation ID but loses access to its Android Keystore credential. Studio can repair the existing screen without deleting assignments. The server revokes the previous credential only after replacement enrollment succeeds.

Supported Linux Players can use [Presentation Networks](docs/presentation-networks.md) for temporary AirPlay Wi-Fi discovery while Ethernet remains the default Tilecast and group-RTP path. The feature is self-hosted, uses an external `TILECAST_PRESENTATION_NETWORK_KEY`, and keeps credentials out of Studio responses and player commands.

Studio accounts can add two-step verification: an authenticator app, WebAuthn passkeys, and single-use recovery codes. A passkey signs a user in with no username or password and counts as multi-factor on its own. An Owner or Administrator can require enrollment for administrators or for everyone, and can clear a locked-out account's factors; a `tilecast mfa reset` command covers the case where the only Owner is locked out. Passkeys need HTTPS and a hostname, so they are unavailable on a plain-HTTP LAN installation, where authenticator apps and recovery codes still work. See [Multi-factor authentication and passkeys](docs/multi-factor-authentication.md).

Tilecast can tell a person about a problem instead of waiting for somebody to open Studio. Notifications follow the incident model, so a screen that drops out ten times sends one message when the incident opens and one when it recovers. Email needs an SMTP relay in the server environment; signed webhooks need nothing and reach a chat service through a relay you control. Every account is unsubscribed until it opts in, quiet hours and a daily digest hold anything that is not critical, and a delivery log records what was sent. Content Health names the quiet failures beside them: a Data Source serving stale cache, a playlist with nothing available, media about to expire, and screens with nothing assigned. See [Notifications](docs/notifications.md).

Bulk changes apply one action to many screens, and show exactly what will change first: which screens move, which are already in that state, which are blocked and why, and which extra screens a sync group brings along, because assigning one member of a sync group assigns them all. An assignment change can be undone for fifteen minutes; a command cannot, and Tilecast says so instead of offering an undo that would not work. See [Bulk changes](docs/fleet-operations.md).

Integration tokens let another system write a Manual Table Data Source, or let existing monitoring read fleet health as JSON or Prometheus metrics, without sharing a Studio password. The capability set is closed: a token cannot create or delete content, touch screens, reach administration, or mint another token, and a write cannot change the columns Widgets bind to. Each token is attributed to the account that created it and stops working if that account is removed. See [Integration tokens](docs/integrations.md).

A Contributor role creates and edits content but cannot publish a Layout, delete anything, or put content on a screen, so a student club or a volunteer can build a slide that somebody checks first. Drafts are separate from published content: an author can keep editing while an immutable submission is in review, and only publication can change live displays. Review policy supports off, Contributors-only, and everyone, with self-approval and durable scheduled publication controls. Screen scopes narrow an account to named buildings or sync groups for screen operations, while leaving the shared content library alone; no grants means the whole fleet, and an Owner is never scoped. See [Content review](docs/content-review.md) and [Screen scopes](docs/screen-scopes.md).

Campaigns coordinate multiple Playlist/Layout blocks and screen or Display Group destinations through the same scheduler. Each release is preflighted, immutable, reviewable, rollback-safe, and materialized into ordinary Player schedules, so a campaign does not introduce a second playback model. See [API and campaign workflow](docs/api.md#campaigns).

Snapshot history keeps bounded periodic images of what screens showed, so "what was on it at 10:14" is answerable over a break or after a complaint. It is off by default, capped three independent ways, stored in the database and therefore inside backups, and every surface states what it proves: the Player rendered that frame, not that the television was on or on the right input. Playlists and Layouts now share immutable version and publication history: Restore as draft preserves live state, while deliberate rollback creates a new publication and never rewrites later history. See [Snapshot history](docs/snapshots.md) and [Playlist history](docs/playlist-history.md).

Tilecast Studio and Tilecast Player use the [Tilecast Signal design system](docs/design-system.md) for shared color, typography, spacing, status, focus, and accessibility behavior.

Built-in Plugins extend Tilecast with bounded workflows and Player behavior without loading third-party code. Forms provides submission and approval workflows, while Countdown Bar supports recurring or one-time targeted bars, overlay and aspect-preserving push modes, local clock evaluation, and cached offline operation on both the Linux and Android Players. Emergency Alerts can answer a matching NWS alert on the same bar channel, as a scrolling ticker that leaves playback running instead of taking the screen over. Brand Bug / Watermark holds a logo, sponsor mark, legal notice, campaign badge, or location label in any corner over all normal content, with screen-relative sizing, an optional date window, and one mark per corner. It is drawn by the Linux Player. See [Built-in plugins](docs/plugins.md).

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
make docs-check
```

## Production notes

- Put Tilecast behind an HTTPS reverse proxy or use the optional Cloudflare Tunnel profile.
- Set `TILECAST_PUBLIC_URL` to the externally reachable HTTPS URL and `TILECAST_COOKIE_SECURE=true`.
- Keep PostgreSQL and the Tilecast data volume on persistent storage.
- Back up both volumes. PostgreSQL and `/data/media` are both required for a complete Milestone 3 backup; automated backup/restore tooling remains scheduled for Milestone 9.
- Never commit `.env` or a Tunnel token.

See [deployment documentation](docs/deployment.md), [architecture](docs/architecture.md), [API documentation](docs/api.md), [documentation style](docs/documentation-style.md), and [development setup](docs/development.md).

## Android TV player

Build the sideloadable debug APK with:

```sh
cd apps/player-android
./gradlew assembleDebug
```

The APK is written to `apps/player-android/app/build/outputs/apk/debug/app-debug.apk`. Release builds are unsigned unless a signing configuration is supplied outside the repository. See [Android development](docs/android-development.md), [Fire TV sideloading](docs/fire-tv.md), and [Google TV testing](docs/google-tv.md).

## Linux player

The Linux player packages as an AppImage for x86_64 signage computers. It supports the same core pairing, playback, scheduling, layouts, widgets, offline cache, remote commands, live previews, ephemeral live streaming, and Takeover model as the Android player.

The Tilecast Server provides a Linux installer. The installer downloads the
AppImage, checksum, systemd unit, and AirPlay source archive from the server.
AirPlay setup also needs Debian package mirrors for build dependencies. Use
`--without-airplay` when the machine cannot reach those mirrors. A failed
AirPlay setup does not stop Player installation or pairing.

Build and run it from source with:

```sh
npm ci
npm run player:linux
```

Create local AppImage and Debian packages with:

```sh
npm run player:linux:dist
```

For deployment, pairing, systemd autostart, kiosk setup, platform differences, and troubleshooting, see [Install Tilecast Player](https://github.com/Gibsonmb71/tilecast/wiki/Install-Tilecast-Player), [Reliability and Kiosk](https://github.com/Gibsonmb71/tilecast/wiki/Reliability-and-Kiosk), and [Troubleshooting](https://github.com/Gibsonmb71/tilecast/wiki/Troubleshooting) in the wiki.

## Repository map

```text
apps/server/          Go server and embedded dashboard
apps/dashboard/       React and TypeScript management UI
apps/player-android/  Native Fire TV, Google TV, and Android TV player
apps/player-linux/    Electron Linux kiosk player
packages/             Versioned public schemas and design tokens
deploy/               Docker, optional Tunnel, and deployment examples
docs/                 Architecture, API, protocol, and operations documentation
wiki/                 Source-controlled pages synced to the GitHub Wiki
```

## License

Tilecast is licensed under the [GNU Affero General Public License v3.0](LICENSE). Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first.
