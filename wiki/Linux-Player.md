# Linux Player

Tilecast Player for Linux turns an ordinary Linux computer into a remotely managed signage player. It uses the same Tilecast server, pairing flow, screen assignments, playlists, schedules, layouts, widgets, and emergency controls as the Android player.

The Linux player is intended for mini PCs, thin clients, repurposed signage computers, and other devices that can run a lightweight graphical Linux session.

## What works

The Linux player supports:

- Six-character screen pairing and persistent device credentials
- Images, videos, websites, YouTube, playlists, and multi-zone layouts
- Native and declarative widgets, including data-source-driven content
- Weekly and one-time schedules
- Emergency takeover content
- Offline startup from the cached manifest and media
- Remote configuration and persistent player commands
- Screen identification and on-demand live previews
- Active hours and an outside-hours black or branded screen
- Playback watchdog recovery, safe mode, and process relaunch
- LAN server discovery through mDNS
- Signed AppImage self-updates when the player is running as a managed AppImage

The player keeps cached content available through server outages and restarts. New content is downloaded and verified before it replaces the active manifest.

## Current platform target

The automated release process publishes an **x86_64 AppImage**. That is the recommended format for Intel and AMD Linux signage computers.

ARM and Raspberry Pi-class hardware can be evaluated with a source build, but there is not currently a separately published or broadly validated ARM release. Do not assume a Raspberry Pi model is supported until it has been tested with the intended desktop, GPU driver, video formats, and resolution.

The reference low-end target is roughly a 2012-era Intel mini PC with 4 GB of RAM. The player includes Intel VA-API tuning, a 30 fps default cap, bounded memory use, and software-rendering fallbacks.

## Linux and Android differences

| Capability                                                     | Linux                                     | Android / Fire TV / Google TV                                |
| -------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Core playback, scheduling, layouts, widgets, and offline cache | Supported                                 | Supported                                                    |
| Kiosk lockdown                                                 | Linux desktop or kiosk compositor         | Android lock task, device owner, or accessibility assistance |
| Start at boot and crash recovery                               | systemd plus a graphical session          | Android boot receiver and platform services                  |
| Self-update                                                    | Replaces the running AppImage             | Installs a signed APK                                        |
| HDMI-CEC and TV sleep/wake assistance                          | Not provided                              | Best-effort Android platform behavior                        |
| Live screen preview                                            | Best on X11; Wayland may require a portal | Supported by the Android player                              |
| Secure sandboxing for remote `web` declarative presentations   | Not yet implemented                       | Platform-dependent                                           |

Tilecast does not create or manage the Linux graphical session itself. The computer must already start X11, Wayland, a desktop environment, or a kiosk compositor before the player launches.

## Recommended deployment

For a permanent screen:

1. Install a minimal Linux desktop or kiosk session.
2. Place the AppImage at `~/tilecast/tilecast-player.AppImage`.
3. Launch it once and pair the screen with Tilecast Studio.
4. Install the included systemd user service.
5. Configure automatic login or a kiosk compositor so a display session exists after boot.
6. Test a power loss, network outage, video playlist, live preview, and remote restart before considering the screen production-ready.

Continue with:

- [Installing the Linux Player](Installing-the-Linux-Player)
- [Linux Kiosk and Autostart](Linux-Kiosk-and-Autostart)
- [Linux Player Troubleshooting](Linux-Player-Troubleshooting)
