# Troubleshooting

Start with the narrowest failing layer: server, network, pairing, content, manifest, playback, Android capability, or the Linux graphical session.

Most sections below apply to both players. Issues specific to the Linux AppImage — the graphical session, systemd service, framebuffer preview, and AppImage self-update — are grouped under [Linux player issues](#linux-player-issues).

## Server does not open

Check containers:

```sh
docker compose   --env-file deploy/docker/.env   -f deploy/docker/compose.yml   ps
```

Check health and readiness:

```sh
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
```

Read logs:

```sh
docker compose   --env-file deploy/docker/.env   -f deploy/docker/compose.yml   logs --tail=300 server postgres
```

Common causes:

- missing or invalid `POSTGRES_PASSWORD`
- PostgreSQL volume or permission failure
- unwritable `tilecast_data` volume
- FFmpeg or FFprobe readiness failure
- port 8080 already in use
- reverse proxy pointing to the wrong service

## Browser login loops or fails behind HTTPS

Confirm:

```dotenv
TILECAST_PUBLIC_URL=https://the-exact-hostname.example.org
TILECAST_COOKIE_SECURE=true
```

The browser origin, proxy hostname, and configured public URL must agree.

## Player cannot discover the server

Discovery is optional and may fail because of:

- Docker bridge networking
- different VLANs
- guest Wi-Fi
- AP or client isolation
- multicast filtering
- routed networks

Enter the server URL manually.

## Player rejects the server URL

Public hostnames require HTTPS. Plain HTTP is accepted only for private, link-local, localhost, and `.local` destinations.

Do not replace an HTTPS URL with HTTP to work around a certificate or proxy problem. Fix HTTPS.

## Pairing code is not found

- Codes expire after ten minutes.
- Confirm all six characters.
- Create a new request on the TV.
- Confirm the browser is on the same Tilecast installation.
- Check that an access gateway is not blocking player API requests.

## Previously paired player asks to pair again

Review the request before deleting anything.

If Studio recognizes the stable installation ID, use **Repair and replace credential**. This preserves assignments and revokes the old credential only after successful enrollment.

## Screen is Offline, Stale, or Recently online

- **Recently online**: last contact within two minutes
- **Stale**: more than two and no more than fifteen minutes
- **Offline**: more than fifteen minutes

Check:

- TV and player power
- Wi-Fi association
- DNS
- server reachability from the TV network
- reverse-proxy WebSocket support
- changed Wi-Fi credentials
- captive portal
- Android background restrictions
- server logs

Cached playback can continue even while Studio reports a connectivity problem.

## Media remains Waiting or Processing

Check `/readyz`, free disk space, and server logs.

Open the asset to view its error. Failed items can be retried after correcting the underlying problem.

Large video files may need substantial temporary free space during processing.

## Website Source does not load

Check:

1. The URL works on another device on the same network.
2. Public URLs use HTTPS.
3. Private HTTP is enabled only when intentionally allowed by the server administrator.
4. The top-level navigation host is allowed.
5. JavaScript, DOM storage, and cookie policy match the site.
6. The load timeout is long enough.
7. The site does not require credentials Tilecast does not store.
8. A fallback image or safe failure behavior is configured.

The server validates Website configuration but does not fetch the page on behalf of the player. A page can be valid yet unreachable from the TV network.

## YouTube Source fails

- Confirm the TV network can reach YouTube and the embedded player.
- Confirm the URL is a supported video or playlist URL.
- Check start and end values.
- Try the placeholder or fallback image behavior.
- Remember that YouTube is streamed and is unavailable offline.

## Wrong playlist is showing

Check in this order:

1. Active emergency
2. Winning schedule
3. Direct fallback assignment
4. Manifest synchronization state

For schedule conflicts, check priority, direct versus group targeting, effective start, timezone, enabled state, and device clock skew.

## New content never activates

A pending downloaded manifest does not activate until every required file passes size and SHA-256 verification.

Check:

- player storage
- cache limit
- minimum free-space policy
- media delivery endpoint
- network interruption
- failed content items
- manifest error shown in Studio

The old working manifest should remain active.

## Managed Kiosk requested but not active

Requested policy is not proof of capability.

Managed Kiosk requires compatible device-owner/device-policy provisioning and confirmed lock task. Consumer Fire TV firmware may not support it.

## Accessibility Control requested but not active

Enable the service manually in Android Accessibility Settings on that player. Server policy cannot grant the permission.

## TV stays on outside active hours

Tilecast may only be able to show black. It does not send direct HDMI-CEC commands.

Review the reported sleep strategy and the per-screen physical Power Assist test.

## Player enters safe mode

Use the local maintenance sequence:

```text
Back, Back, Up, Down, Select
```

Enter the maintenance PIN, review self-test and recovery state, then retry or exit safe mode after correcting the failure.

Owners and Administrators can also use typed recovery and synchronization commands from Studio.

## Update waits for permission or user

On the TV, allow Tilecast Player under **Install unknown apps**, then approve the Android or Fire OS system installer.

These states are expected. Tilecast does not claim silent installation.

## Linux player issues

These apply to the Linux AppImage. Server, network, pairing, content, and playback-selection sections above apply to Linux screens too.

### Start with the logs

For a systemd user installation:

```sh
systemctl --user status tilecast-player
journalctl --user -u tilecast-player -n 200 --no-pager
journalctl --user -u tilecast-player -f
```

For an interactive diagnostic run:

```sh
systemctl --user stop tilecast-player
TILECAST_LOG_LEVEL=debug TILECAST_WINDOWED=1 \
  ~/tilecast/tilecast-player.AppImage
```

Stop the interactive copy before restarting the service. Tilecast allows only one player instance at a time.

### The AppImage does not open

Confirm it is executable and owned by the kiosk user, and not run as root:

```sh
ls -l ~/tilecast/tilecast-player.AppImage
chmod +x ~/tilecast/tilecast-player.AppImage
```

If the terminal reports a FUSE error, start the player with `--appimage-extract-and-run` and confirm the systemd unit includes that argument. This supported mode is the Tilecast default and needs no FUSE package while retaining managed self-updates. If the systemd log reports that the display cannot be opened, the service started without a graphical session or has the wrong `DISPLAY` or `WAYLAND_DISPLAY` value.

### The service is running but no window appears

Check the current graphical environment:

```sh
printf 'DISPLAY=%s\nWAYLAND_DISPLAY=%s\n' "$DISPLAY" "$WAYLAND_DISPLAY"
```

Run the AppImage manually from a terminal inside the same desktop session. If that works, add the required display variable to the systemd drop-in. Also verify the service's `ExecStart` path exactly matches the AppImage location.

### Change the saved server address

The saved address is stored at `~/.local/share/tilecast-player/server.json`. Stop the service, remove only that file, and restart:

```sh
systemctl --user stop tilecast-player
rm ~/.local/share/tilecast-player/server.json
systemctl --user start tilecast-player
```

A credential enrolled with another Tilecast installation is not sent to the new server.

### Re-pair the same installation

Remove or revoke the old screen in Studio when possible, then remove the credential and unfinished pairing session while preserving `installation.json`:

```sh
systemctl --user stop tilecast-player
cd ~/.local/share/tilecast-player
rm -f credential.json pairing-session.json
systemctl --user start tilecast-player
```

Preserving `installation.json` keeps the stable player installation ID. Moving the entire data directory aside creates a completely new local identity and removes cached content, so the old screen record must then be cleaned up in Studio.

### Content is black, corrupted, or stuttering

Test with hardware video decode disabled, then software rendering:

```sh
TILECAST_HW_DECODE=0 TILECAST_WINDOWED=1 ~/tilecast/tilecast-player.AppImage
TILECAST_DISABLE_GPU=1 TILECAST_WINDOWED=1 ~/tilecast/tilecast-player.AppImage
```

Apply a successful setting to the service with `systemctl --user edit tilecast-player`. Prefer H.264 video, test the actual display resolution and refresh rate, avoid overlapping videos in multiple layout zones on low-end hardware, and confirm media finished downloading before disconnecting the network.

### Cached content disappears after reboot

The service may run as a different user or with a different `TILECAST_DATA_DIR` than the interactive test:

```sh
systemctl --user show tilecast-player -p Environment
ls -ld ~/.local/share/tilecast-player
```

Keep the data directory on persistent local storage.

### Live preview is unavailable or black

On X11, Tilecast captures the actual display framebuffer, so video overlays and website content appear in the preview. On Wayland, screen capture usually requires a desktop portal and may show a prompt an unattended kiosk cannot answer; the player defaults to window capture there, which can miss hardware-overlay video and embedded website frames.

Options: use X11 for the kiosk session; accept and persist the Wayland portal permission when supported; test `TILECAST_PREVIEW_SCREEN_CAPTURE=1`; or disable framebuffer capture with `TILECAST_PREVIEW_SCREEN_CAPTURE=0` when the portal blocks startup. Preview failure does not stop normal playback.

### Remote AppImage update fails

Studio-driven Linux updates require the player to be running as a managed AppImage. AppImage runtime extraction through `--appimage-extract-and-run` remains managed because the runtime preserves `$APPIMAGE`; a development run or manually unpacked `squashfs-root/AppRun` does not. Also verify the AppImage and its parent directory are writable by the kiosk user, the release is a Linux release with a signed update manifest, there is enough free space for the staged AppImage, and the systemd service points to the same AppImage that is currently running.

### The display still sleeps or shows a lock screen

Tilecast requests a display-sleep blocker, but desktop policies can still lock or suspend the session. Disable lock-screen, screensaver, suspend, and hibernate behavior for the kiosk account, and test the monitor's own sleep timer separately. Active hours intentionally replace playback with a black or configured outside-hours presentation; an emergency overrides that.

## Still stuck

Collect the information listed in [[Support and Contributing]] without including credentials, tokens, signing keys, or private URLs.
