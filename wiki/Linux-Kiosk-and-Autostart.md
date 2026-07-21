# Linux Kiosk and Autostart

A production Linux screen needs two separate pieces:

1. A graphical session that starts after boot.
2. Tilecast Player running inside that session and restarting after failure.

Tilecast manages the player window, playback, cache, and recovery. It does **not** start X11, Wayland, a desktop environment, or a kiosk compositor.

## Prepare the kiosk account

Create or choose a normal, non-root Linux user dedicated to signage. Configure the operating system to sign that account in automatically, or configure a kiosk compositor that starts a graphical session without operator input.

Before installing autostart, verify that this works after a full reboot:

```sh
~/tilecast/tilecast-player.AppImage
```

The player should open on the intended display, enter fullscreen, and remain visible without a terminal window.

Also disable desktop features that can cover signage, including:

- Screen locking
- Screen savers
- Desktop notifications
- Automatic suspend or hibernation
- Update prompts that appear above applications

Tilecast requests that Linux keep the display awake while the player runs, but operating-system, monitor, firmware, and workplace policies must still be tested on the actual device.

## Install the systemd user service

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
ExecStart=%h/tilecast/tilecast-player.AppImage
Restart=always
RestartSec=5
Environment=TILECAST_LOG_LEVEL=info

[Install]
WantedBy=graphical-session.target
```

Then enable it:

```sh
systemctl --user daemon-reload
systemctl --user enable --now tilecast-player
```

Check the service:

```sh
systemctl --user status tilecast-player
journalctl --user -u tilecast-player -n 100 --no-pager
```

The service restarts the process after crashes, out-of-memory termination, and remote process-restart commands.

## Set the display environment when required

Most desktop sessions provide the display environment automatically. Minimal kiosk sessions may require an override.

Create a drop-in:

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

## Set the server URL in the service

The player normally saves the server selected during first-run setup. For preconfigured deployments, add it as a service environment variable:

```sh
systemctl --user edit tilecast-player
```

```ini
[Service]
Environment=TILECAST_SERVER_URL=https://signage.example.org
```

Use the externally reachable Tilecast URL that this device should trust. A stored credential is never sent when the server installation identity does not match the installation used during enrollment.

## Starting without an interactive login

You can keep the user's systemd manager running across logouts with:

```sh
sudo loginctl enable-linger "$USER"
```

Linger does not create a graphical display. The player still needs X11, Wayland, a desktop auto-login session, or a compositor service. On a normal desktop kiosk, automatic login is usually the simplest approach.

## Low-end hardware settings

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

## Production validation checklist

Before leaving a device unattended, test:

- Cold boot into the graphical session and Tilecast
- Pairing and screen assignment
- Images, videos, websites, layouts, and widgets used by that screen
- Audio behavior, if the display uses audio
- Network disconnection while cached content is playing
- Server restart and automatic reconnection
- Remote identify, restart, and live preview
- Active-hours sleep and wake behavior
- A physical power loss and recovery
- Display resolution, scaling, rotation, and overscan
- At least one full day of continuous playback

Next: [Linux Player Troubleshooting](Linux-Player-Troubleshooting)
