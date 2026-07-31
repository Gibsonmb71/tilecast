# Reliability and Kiosk

The unattended-screen configuration is platform-specific.

On Android, Tilecast separates the requested policy from confirmed device capabilities. A Studio policy does not prove that the device supports it.

On Linux, reliability requires a graphical session and a systemd service. Tilecast does not create the graphical session.

Both platforms share the recovery supervisor, safe mode, active hours, and the physical-testing discipline described near the end of this page.

## Android reliability modes

### Standard Reliability

Works with a normally installed APK and provides:

- cached startup
- boot recovery attempts
- immersive fullscreen
- keep-awake behavior
- bounded playback recovery
- persistent safe mode
- optional Accessibility Control Assist

Android can still allow a user to leave the app.

### Managed Kiosk

Managed Kiosk is effective only when Android confirms:

- compatible device-owner or device-policy provisioning
- active lock task

Provisioning may require a factory reset and ADB, QR enrollment, or manufacturer-specific setup. Tilecast does not silently turn an existing consumer TV into a managed device.

When Managed Kiosk is requested but not confirmed, Studio reports the effective mode as Standard Reliability.

### First-run commissioning (Android)

Every newly paired Android player completes a local wizard. It verifies or configures:

- maintenance PIN
- Accessibility Settings
- unknown-app installation permission
- boot return
- immersive mode
- keep-awake behavior
- cached fallback availability
- self-test
- final readiness reporting

Protected Android settings require a person to use Android's system UI. Tilecast does not mark them complete based only on a server policy.

Use **Run setup again** from the local maintenance menu when a permission or device configuration changes.

### Zero-Touch Readiness (Android)

Studio summarizes readiness from reported capability and commissioning results.

Typical states:

- **Ready**: required checks passed
- **Partially ready**: commissioned, but one or more requested capabilities are unavailable or incomplete
- **Needs setup**: commissioning is incomplete
- **Unsupported**: a required platform capability is explicitly unavailable

This status describes the Android player. Physical TV power and input behavior are recorded separately.

### Power Assist (Android)

Power Assist uses Android device sleep and wake behavior. Some devices may relay that through HDMI-CEC.

Tilecast does not send raw HDMI-CEC commands.

A resumed Android process does not prove that the physical TV powered on, selected the correct input, woke from standby, or is showing Tilecast. Use the per-screen physical confirmation workflow and record the exact model and firmware.

### Accessibility Control Assist (Android)

Accessibility Control must be enabled locally in Android Accessibility Settings.

It can observe foreground package changes, wait and return to Tilecast, and request Android's global lock action for Power Assist. It cannot read window text or passwords, click controls, perform gestures, approve an installer, navigate Settings for the user, or change network configuration.

Settings, package installers, permission controllers, captive portals, setup components, and configured maintenance apps are excluded. Automatic return pauses during maintenance and updates.

### Local maintenance menu (Android)

Default remote sequence:

```text
Back, Back, Up, Down, Select
```

The first use creates a 4–12 digit PIN. Only a salted password hash is stored. Failed attempts are rate-limited.

Maintenance provides fixed actions for Android network and settings pages, Accessibility Settings, unknown-app installation permission, safe-mode recovery, Tilecast restart, and return to playback. It is not a shell or arbitrary app launcher.

## Linux kiosk and autostart

A production Linux screen needs two separate pieces:

1. A graphical session that starts after boot.
2. Tilecast Player running inside that session and restarting after failure.

Tilecast manages the Player window, playback, cache, recovery, and its systemd user service. Studio can control the systemd user service.

Tilecast does **not** start X11, Wayland, a desktop environment, or a kiosk compositor.

You can install piece 2 remotely. You must configure piece 1 on the device.

The **Launch after boot** setting under Reliability and kiosk is Android-only. On Linux, boot launch is the systemd user service described below.

### Prepare the kiosk account

Create or choose a normal, non-root Linux user dedicated to signage. Configure the operating system to sign that account in automatically, or configure a kiosk compositor that starts a graphical session without operator input.

Before installing autostart, verify that this works after a full reboot:

```sh
~/tilecast/tilecast-player.AppImage
```

The player should open on the intended display, enter fullscreen, and remain visible without a terminal window.

Disable desktop features that can cover the signage. These features include:

- Screen locks and screen savers
- Desktop notifications
- Automatic suspend or hibernation
- Update prompts that appear above applications

Tilecast requests that Linux keep the display awake while the Player operates. Test the operating-system, monitor, firmware, and workplace policies on the device.

### Set up autostart from Studio

On a paired Linux screen, open **Screens → the screen → Reliability → Linux autostart**. Select **Set up autostart**.

The Player writes and enables `~/.config/systemd/user/tilecast-player.service`. It reads these values from the active session:

- AppImage path
- `DISPLAY` or `WAYLAND_DISPLAY`
- Data directory
- `graphical-session.target` availability

These values frequently cause errors in a manually written service.

The action is safe on a live screen:

- It enables the service but does not start it. A start operation would open a second Player process.
- The service takes effect at the next boot or session start.
- **Remove autostart** disables and deletes the service without stopping the running player.
- Neither action changes a service file that Tilecast did not generate.
- You can edit the generated file. Remove or change its marker line to prevent subsequent Tilecast changes.

Afterwards the screen's reliability panel reports:

- **Autostart (systemd):** Shows the installation state, target, and detected boot-start state.
- **Launch after boot:** Shows `Verified` after systemd starts the Player from a cold boot.

Reboot the device one time after service installation. Confirm that **Launch after boot** shows `Verified`.

Studio warns when the service is missing, present but not enabled, or enabled against `default.target` without lingering.

If the device has no systemd user manager, the command reports `autostart_unsupported`. It does not change the device.

The command gives the same result when the Player does not use a managed AppImage. In these conditions, install the service manually.

Setting up autostart also protects remote updates: an update replaces the AppImage and exits, expecting the service to start the new version. A Linux screen without autostart goes dark on its next update until someone visits it.

### Install the systemd user service by hand

Use manual installation when the Player cannot reach a systemd user manager. Also use it before screen pairing.

Manual installation also permits service options that the generated service does not contain.

Create the user service directory:

```sh
mkdir -p ~/.config/systemd/user
```

Create `~/.config/systemd/user/tilecast-player.service`:

```ini
[Unit]
Description=Tilecast Player
After=graphical-session.target network.target
PartOf=graphical-session.target
StartLimitIntervalSec=0

[Service]
Type=simple
# Remove stale FUSE mounts left by a legacy AppImage launch before retrying.
# The command only targets AppImage temporary FUSE mountpoints and is
# best-effort; current releases use extract-and-run and do not mount FUSE.
ExecStartPre=/bin/sh -c 'command -v findmnt >/dev/null 2>&1 || exit 0; findmnt -rn -o TARGET,FSTYPE | while read -r mountpoint fstype; do case "$mountpoint:$fstype" in /tmp/.mount_*:fuse*) fusermount3 -uz "$mountpoint" 2>/dev/null || fusermount -uz "$mountpoint" 2>/dev/null || umount -l "$mountpoint" 2>/dev/null || true; rmdir "$mountpoint" 2>/dev/null || true;; esac; done'
ExecStart=%h/tilecast/tilecast-player.AppImage --appimage-extract-and-run
Restart=always
RestartSec=5
Environment=TILECAST_LOG_LEVEL=info

[Install]
WantedBy=graphical-session.target
```

Extract-and-run is the managed, FUSE-independent startup path. It still
preserves the original AppImage path for signed Studio updates. Do not manually
unpack and launch `squashfs-root/AppRun`. The pre-start cleanup is best-effort
and only handles stale FUSE mounts under `/tmp/.mount_*`; it does not recursively
delete temporary directories.

Then enable it:

```sh
systemctl --user daemon-reload
systemctl --user enable tilecast-player
```

`enable` without `--now` on purpose: if a player is already running on the device, starting the service launches a second copy over the first. The service takes effect at the next boot or session start.

Start it now only when no player is running:

```sh
pgrep -f tilecast-player.AppImage || systemctl --user start tilecast-player
```

Check the service:

```sh
systemctl --user status tilecast-player
journalctl --user -u tilecast-player -n 100 --no-pager
```

The service restarts the process after crashes, out-of-memory termination, and remote process-restart commands.

### Set the display environment when required

Most desktop sessions provide the display environment automatically. Minimal kiosk sessions may require an override.

```sh
systemctl --user edit tilecast-player
```

For X11:

```ini
[Service]
Environment=DISPLAY=:0
```

For Wayland:

```ini
[Service]
Environment=WAYLAND_DISPLAY=wayland-0
```

The exact display name can differ. Check the working graphical session with:

```sh
printf 'DISPLAY=%s\nWAYLAND_DISPLAY=%s\n' "$DISPLAY" "$WAYLAND_DISPLAY"
```

Restart after changing the unit:

```sh
systemctl --user daemon-reload
systemctl --user restart tilecast-player
```

### Set the server URL in the service

The player normally saves the server selected during first-run setup. For preconfigured deployments, add it as a service environment variable:

```sh
systemctl --user edit tilecast-player
```

```ini
[Service]
Environment=TILECAST_SERVER_URL=https://signage.example.org
```

Use the externally reachable Tilecast URL that this device should trust. A stored credential is never sent when the server installation identity does not match the installation used during enrollment.

### Starting without an interactive login

You can keep the user's systemd manager running across logouts with:

```sh
sudo loginctl enable-linger "$USER"
```

Linger does not create a graphical display. The player still needs X11, Wayland, a desktop auto-login session, or a compositor service. On a normal desktop kiosk, automatic login is usually the simplest approach.

### Low-end hardware settings (Linux)

Start with the defaults. The player enables Intel VA-API hardware video decode when available, limits background resource use, and caps playback at 30 fps.

When diagnosing old or unreliable graphics hardware, add one setting at a time through `systemctl --user edit tilecast-player`:

```ini
[Service]
Environment=TILECAST_HW_DECODE=0
```

or:

```ini
[Service]
Environment=TILECAST_DISABLE_GPU=1
```

For especially limited hardware:

```ini
[Service]
Environment=TILECAST_MAX_FPS=24
```

Software rendering and software video decode can substantially increase CPU use. Test the longest and highest-resolution videos used by the real signage schedule.

## Active hours

Active hours define when ordinary presentation should run. They apply to both platforms.

Outside active hours, Player:

- saves state
- stops media decoding
- releases keep-screen-on
- pauses ordinary presentation
- uses device sleep when authorized on Android. Otherwise, it shows black or the configured outside-hours screen.

An emergency overrides off-hours sleep or black-screen behavior.

Overnight ranges are supported. An end time at or before the start belongs to the following day.

## Recovery and safe mode

The recovery supervisor uses bounded steps on both platforms:

1. retry
2. skip failed item
3. recreate renderer
4. recreate playback session
5. restart activity or window
6. bounded process recovery (Android activity restart, Linux systemd process relaunch)
7. safe mode

Safe mode avoids an endless crash loop. It preserves pairing, networking, health reporting, commands, local maintenance, cache validation, and manual recovery. It does not delete credentials or content.

## Boot recovery

On Android, Player detects normal and locked boot completion. It requests a foreground start and retries after bounded delays.

Some firmware blocks background activity starts. Tilecast reports this limitation and does not report a successful recovery.

On Linux, boot recovery requires the graphical session and the systemd service. Tilecast does not create the graphical session.

Do a cold-boot test. Make sure that the display starts and that the Player opens.

## Production validation

Before leaving a device unattended, test each device and firmware for:

- launch after power restoration on Android and Linux
- pairing and screen assignment
- images, videos, websites, layouts, and widgets used by that screen
- audio behavior, if the display uses audio
- network disconnection while cached content is playing
- server restart and automatic reconnection
- remote identify, restart, and live preview
- active-hours sleep and wake behavior
- a physical power loss and recovery
- display resolution, scaling, rotation, and overscan
- Android-only: Accessibility Control, unknown-app install flow, standby and wake, TV power response, HDMI input selection, remote focus, update approval
- at least one full day of continuous playback

See [[Known Limitations]] before advertising zero-touch or kiosk capability.
