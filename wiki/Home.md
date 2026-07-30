# Tilecast Wiki

Tilecast is a self-hosted digital signage system. Tilecast Studio runs in a browser. Tilecast Player runs on each display device, either on an Android TV device (Fire TV, Google TV, Android TV) or on an Intel or AMD Linux computer.

This wiki is the operator manual: install the server, enroll players, build content, schedule playback, and keep screens running. Implementation details and protocol contracts stay in the repository's [versioned technical documentation](https://github.com/Gibsonmb71/tilecast/tree/main/docs).

## Start here

New installation:

1. [[Install the server|Server Installation]]
2. [[Install Tilecast Player]] on an Android TV device or a Linux computer
3. [[Pair the first screen|Pair a Screen]]
4. [[Add content|Content Library]]
5. [[Build a playlist|Playlists]]
6. Assign that playlist directly to the screen as fallback content.
7. Add [[Schedules]] when the fallback should be replaced at specific times.

Existing installation:

- [[Screens and Groups]] explains status, assignments, and grouping.
- [[Reliability and Kiosk]] covers commissioning, active hours, recovery, and kiosk behavior on both platforms.
- [[Emergency Takeover and Commands]] covers urgent overrides and remote player actions.
- [[Player Updates]] covers signed Android APK and Linux AppImage releases and staged deployment.
- [[Backups and Upgrades]] covers the PostgreSQL and `/data` volumes.

## Player platforms

Tilecast Player is one product with two builds. Both use the same server, pairing flow, screen assignments, playlists, schedules, layouts, widgets, emergency controls, offline cache, and signed updates. They differ only in how the host device is locked down, started at boot, and updated.

| Capability                                                 | Android TV / Fire TV / Google TV                             | Linux (x86_64)                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Core playback, scheduling, layouts, widgets, offline cache | Supported                                                    | Supported                                       |
| Install format                                             | Signed APK (`tilecast-player.apk`)                           | AppImage (`tilecast-player.AppImage`)           |
| Kiosk lockdown                                             | Android lock task, device owner, or accessibility assistance | Linux desktop or kiosk compositor               |
| Start at boot and crash recovery                           | Android boot receiver and platform services                  | systemd plus a graphical session                |
| Self-update                                                | Installs a signed APK                                        | Replaces the running AppImage                   |
| HDMI-CEC and TV sleep/wake assistance                      | Best-effort Android platform behavior                        | Not provided                                    |
| Live screen preview                                        | Supported                                                    | X11 is preferred. Wayland can require a portal. |

The Linux build targets mini PCs, thin clients, and repurposed signage computers, down to a roughly 2012-era Intel machine with 4 GB of RAM. The Android build targets Fire TV, Google TV, and Android TV without Google Play Services.

## Playback order

For each screen, Tilecast resolves playback in this order:

1. Active emergency takeover
2. Winning schedule
3. Direct screen assignment
4. No-content screen

A direct assignment is the screen's normal fallback. Creating a schedule does not remove it.

When multiple schedules match, Tilecast compares priority first. At equal priority, a direct screen target beats a group target. Remaining ties are resolved deterministically.

## What Tilecast currently supports

- Uploaded images and videos
- Reusable Website and YouTube Sources
- Ordered fullscreen playlists
- Direct screen assignments
- Weekly and one-time schedules
- Screen groups
- Emergency takeovers
- Persistent player commands
- Organization, group, and screen-level player policies
- Cached offline playback
- Standard Reliability and capability-confirmed Managed Kiosk (Android), kiosk-session deployment (Linux)
- Signed Tilecast Player updates for Android and Linux

Read [[Known Limitations]] before planning a deployment around kiosk lockdown, TV power control, authenticated websites, multi-zone layouts, or silent installation.
