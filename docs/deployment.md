# Deployment

## Local network

Copy `deploy/docker/.env.example` to `deploy/docker/.env`, set a strong PostgreSQL password, leave `TILECAST_COOKIE_SECURE=false` for plain HTTP, and start the Compose file. Restrict port 8080 to the trusted LAN with the host firewall.

Docker bridge networking does not reliably publish multicast DNS on every Linux distribution, so `TILECAST_MDNS_ENABLED` is disabled in the Compose example. Players can always use the server's LAN address manually. Advanced Linux installations may enable mDNS when the container has appropriate host-network multicast access.

## HTTPS reverse proxy

Set `TILECAST_PUBLIC_URL` to the external URL and `TILECAST_COOKIE_SECURE=true`. Forward HTTP to `server:8080` on a private Docker network. Preserve WebSocket upgrade headers when player notifications are introduced.

## Cloudflare Tunnel

Cloudflare is optional. Follow [`deploy/cloudflare/README.md`](../deploy/cloudflare/README.md) to enable the profile. The Tunnel route should target `http://server:8080`; do not publish PostgreSQL.

Players using a Tunnel normally enter its public HTTPS hostname manually. LAN discovery advertises local services only and is not a Tunnel discovery mechanism.

## Data and upgrades

The `postgres_data` volume stores relational state. The `tilecast_data` volume stores originals, playback variants, thumbnails, posters, and temporary resumable uploads beneath `/data/media`; it must remain mounted across server/container recreation. The media tree is never served directly by the container.

The production image includes FFmpeg and FFprobe and runs as the unprivileged `tilecast` user. Readiness checks database access, writable media storage, and both executables. Configure limits with `TILECAST_MAX_UPLOAD_BYTES`, `TILECAST_MEDIA_WORKERS`, `TILECAST_MEDIA_RESERVED_FREE_BYTES`, `TILECAST_VIDEO_MAX_WIDTH`, `TILECAST_VIDEO_MAX_HEIGHT`, `TILECAST_VIDEO_MAX_FRAME_RATE`, and `TILECAST_KEEP_ORIGINALS`.

A complete backup requires:

- the PostgreSQL database;
- `/data/media/originals`;
- `/data/media/variants` and `/data/media/thumbnails` (or time to regenerate them in a future recovery tool);
- deployment configuration, excluding copied secrets from documentation or source control.

Take database and media snapshots from a consistent maintenance window. Restoring only PostgreSQL produces missing-file errors; restoring only media produces unreferenced files. Pin released Tilecast image tags rather than `latest`, back up both volumes before upgrades, and review migration notes. Automated backup/restore tooling remains a Milestone 9 deliverable.
