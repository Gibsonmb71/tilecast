# Reliability and Kiosk

Making a screen unattended is platform-specific. On Android, Tilecast separates requested policy from confirmed device capability; selecting a reliability mode in Studio does not prove the device or firmware supports it. On Linux, reliability comes from a graphical session plus a systemd service that Tilecast does not create for you.

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

Tilecast manages the player window, playback, cache, recovery, and — from Studio — its own systemd user service. It does **not** start X11, Wayland, a desktop environment, or a kiosk compositor. Piece 2 can be installed remotely; piece 1 is operating-system setup on the device.

The **Launch after boot** setting under Reliability and kiosk is Android-only. On Linux, boot launch is the systemd user service described below.

### Prepare the kiosk account

Create or choose a normal, non-root Linux user dedicated to signage. Configure the operating system to sign that account in automatically, or configure a kiosk compositor that starts a graphical session without operator input.

Before installing autostart, verify that this works after a full reboot:

```sh
~/tilecast/tilecast-player.AppImage
```

The player should open on the intended display, enter fullscreen, and remain visible without a terminal window.

Also disable desktop features that can cover signage, including screen locking, screen savers, desktop notifications, automatic suspend or hibernation, and update prompts that appear above applications.

Tilecast requests that Linux keep the display awake while the player runs, but operating-system, monitor, firmware, and workplace policies must still be tested on the actual device.

### Set up autostart from Studio

On a paired Linux screen, open **Screens → the screen → Reliability → Linux autostart** and choose **Set up autostart**. The player writes and enables `~/.config/systemd/user/tilecast-player.service` itself, using values read from the session it is running in: its own AppImage path, its actual `DISPLAY` or `WAYLAND_DISPLAY`, its data directory, and whether `graphical-session.target` is reachable. Those are the settings most often wrong in a hand-written unit.

The action is safe on a live screen:

- It enables the service but never starts it — the running player is the one the service supervises, so starting it would launch a second copy. The service takes effect at the next boot or session start.
- **Remove autostart** disables and deletes the service without stopping the running player.
- Neither action touches a service file Tilecast did not generate. Edit the generated file freely; removing or changing its `# Generated by Tilecast Player` marker line makes Tilecast leave it alone from then on.

Afterwards the screen's reliability panel reports:

- **Autostart (systemd)** — whether the service is installed, which target it is wanted by, and whether it has yet been seen starting the player at boot.
- **Launch after boot** — `Verified` once the player has actually started from a cold boot under systemd. Installing the service is a promise about the next boot; this row is the evidence, so reboot the device once to confirm it.

Studio warns when the service is missing, present but not enabled, or enabled against `default.target` without lingering.

If the device has no systemd user manager, or the player is not running as a managed AppImage, the command reports `autostart_unsupported` and changes nothing; install the service by hand as below.

Setting up autostart also protects remote updates: an update replaces the AppImage and exits, expecting the service to start the new version. A Linux screen without autostart goes dark on its next update until someone visits it.

### Install the systemd user service by hand

Use this when the player cannot reach a systemd user manager, when the screen is not paired yet, or when you want a unit tuned beyond what the generated one covers.

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
ExecStart=%h/tilecast/tilecast-player.AppImage --appimage-extract-and-run
Restart=always
RestartSec=5
Environment=TILECAST_LOG_LEVEL=info

[Install]
WantedBy=graphical-session.target
```

Extract-and-run is the managed, FUSE-independent startup path. It still
preserves the original AppImage path for signed Studio updates; do not manually
unpack and launch `squashfs-root/AppRun`.

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
- uses device sleep when authorized (Android); otherwise displays true black or a configured outside-hours screen

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

On Android, Player listens for normal and locked boot completion, requests a foreground launch, and retries after bounded delays. Some firmware blocks background activity launch; Tilecast reports that limitation instead of claiming recovery succeeded.

On Linux, boot recovery is the graphical session plus the systemd service described above. Tilecast does not create the session; verify a cold boot brings up the display and relaunches the player.

## Production validation

Before leaving a device unattended, test each device and firmware for:

- launch after power restoration (Android boot receiver; Linux cold boot into the graphical session and Tilecast)
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
