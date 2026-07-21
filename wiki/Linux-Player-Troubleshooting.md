# Linux Player Troubleshooting

## Start with the logs

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

## The AppImage does not open

Confirm that it is executable and owned by the kiosk user:

```sh
ls -l ~/tilecast/tilecast-player.AppImage
chmod +x ~/tilecast/tilecast-player.AppImage
```

Do not run the player as root. If the terminal reports a FUSE error, install the distribution's FUSE 2 compatibility package or test with:

```sh
~/tilecast/tilecast-player.AppImage --appimage-extract-and-run
```

If the systemd log reports that the display cannot be opened, the service started without a graphical session or has the wrong `DISPLAY` or `WAYLAND_DISPLAY` value.

## The service is running but no window appears

Check the current graphical environment:

```sh
printf 'DISPLAY=%s\nWAYLAND_DISPLAY=%s\n' "$DISPLAY" "$WAYLAND_DISPLAY"
```

Run the AppImage manually from a terminal inside the same desktop session. If that works, add the required display variable to the systemd drop-in.

Also verify that the service's `ExecStart` path exactly matches the AppImage location.

## The setup screen cannot find the server

LAN discovery uses mDNS and only works where multicast traffic can reach both devices. Discovery can fail across VLANs, guest networks, Wi-Fi client isolation, routed networks, and some school or enterprise networks.

Enter the full server URL manually. Confirm that the player can reach it:

```sh
curl -I https://signage.example.org
```

For local HTTP deployments, include the port. For HTTPS, fix certificate errors rather than bypassing them.

## Pairing never completes

Check:

- The displayed code has not expired.
- The player and browser are using the same Tilecast installation.
- The system clock and timezone are correct.
- The server URL is reachable from the player.
- A reverse proxy is forwarding authenticated HTTP and WebSocket traffic.

The player retries temporary network failures. Expired or rejected pairing sessions are replaced automatically.

## Change the saved server address

The saved address is stored at:

```text
~/.local/share/tilecast-player/server.json
```

Stop the service, remove only that file, and restart:

```sh
systemctl --user stop tilecast-player
rm ~/.local/share/tilecast-player/server.json
systemctl --user start tilecast-player
```

The setup screen returns. A credential enrolled with another Tilecast installation is not sent to the new server.

## Re-pair the same installation

First remove or revoke the old screen in Tilecast Studio when possible. Then stop the player and remove its credential and unfinished pairing session while preserving `installation.json`:

```sh
systemctl --user stop tilecast-player
cd ~/.local/share/tilecast-player
rm -f credential.json pairing-session.json
systemctl --user start tilecast-player
```

Preserving `installation.json` keeps the stable player installation ID.

For a completely new local identity, move the entire data directory out of the way. This also removes cached content and creates a new screen identity, so the old screen record must be cleaned up in Studio.

## Content is black, corrupted, or stuttering

Test with hardware video decode disabled:

```sh
TILECAST_HW_DECODE=0 TILECAST_WINDOWED=1 \
  ~/tilecast/tilecast-player.AppImage
```

If the entire Electron window is affected, test software rendering:

```sh
TILECAST_DISABLE_GPU=1 TILECAST_WINDOWED=1 \
  ~/tilecast/tilecast-player.AppImage
```

Apply a successful setting to the systemd service with `systemctl --user edit tilecast-player`.

Other checks:

- Use H.264 video for the widest compatibility.
- Test the actual display resolution and refresh rate.
- Avoid overlapping videos in multiple layout zones on low-end hardware.
- Confirm that media finished downloading before disconnecting the network.
- Check free space in the player data directory.

## Cached content disappears after reboot

The service may be running as a different user or with a different `TILECAST_DATA_DIR` than the interactive test.

Check the service environment and data ownership:

```sh
systemctl --user show tilecast-player -p Environment
ls -ld ~/.local/share/tilecast-player
```

Keep the data directory on persistent local storage. Do not place it in a temporary home directory or clear it during logout.

## Live preview is unavailable or black

On X11, Tilecast normally captures the actual display framebuffer so video overlays and website content appear in the preview.

On Wayland, screen capture usually requires a desktop portal and may display a permission prompt that an unattended kiosk cannot answer. The player therefore avoids forced framebuffer capture by default on Wayland and falls back to window capture, which can miss hardware-overlay video and embedded website frames.

Options:

- Use X11 for the kiosk session.
- Accept and persist the Wayland portal permission when the desktop supports it.
- Test `TILECAST_PREVIEW_SCREEN_CAPTURE=1`.
- Disable framebuffer capture with `TILECAST_PREVIEW_SCREEN_CAPTURE=0` when the portal blocks startup or preview requests.

Preview failure does not stop normal playback.

## Remote AppImage update fails

Studio-driven Linux updates require the player to be running as an AppImage. Development runs and extracted AppImages report that they are not managed installations.

Also verify:

- The AppImage and its parent directory are writable by the kiosk user.
- The release is a Linux release with a signed update manifest.
- The device has enough free space for the staged AppImage.
- The systemd service points to the same AppImage that is currently running.
- The player reconnects and reports the new version after relaunch.

## The display still sleeps or shows a lock screen

Tilecast requests a display-sleep blocker while it runs, but desktop policies can still lock the session or suspend the computer. Disable lock-screen, screensaver, suspend, and hibernate behavior for the kiosk account. Test the monitor's own sleep timer and any television auto-power setting separately.

Active hours intentionally replace playback with a black or configured outside-hours presentation. An emergency overrides outside-hours sleep.

## The player repeatedly restarts or enters safe mode

Tilecast escalates stalled playback through content reactivation, renderer recreation, window recreation, and process restart. Repeated exhaustion enters safe mode instead of restart-looping forever.

Inspect the logs for the first playback or renderer error. Fix the failing media, website, GPU path, or storage issue, then use Studio's recovery controls or restart the player. Avoid deleting the whole data directory until the original failure has been identified; its persisted watchdog state is useful evidence.
