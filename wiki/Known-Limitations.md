# Known Limitations

Tilecast reports platform limits instead of presenting them as completed capabilities.

## One fullscreen zone

Playback currently uses one fullscreen zone.

Not currently supported:

- multi-zone layouts
- compositions
- simultaneous independent videos
- arbitrary HTML layout builders

The **Layouts** route in Studio is planned, not a completed feature.

## No proof of play

Tilecast has device status, synchronization state, command results, and operational audit records. It does not currently claim proof-of-play reporting.

The **Activity reports** route is planned.

## No authenticated Website Sources

Website Sources do not store usernames, passwords, administrator-supplied session cookies, or other website credentials.

They are intended for public or otherwise directly reachable pages.

## Website host restriction is not a full proxy

The allowed-host setting restricts top-level navigation. Tilecast does not intercept every subresource request and does not claim complete third-party domain blocking.

## No silent APK installation on Android

Android player updates use Android's package installer.

Depending on device and provisioning, a person may need to:

- allow unknown-app installation
- approve the installer
- return to Tilecast

Tilecast does not use root, ADB deployment, simulated taps, or hidden APIs to bypass these prompts.

Linux updates replace the running AppImage without a prompt, but only when the player runs as a managed AppImage. Development runs and extracted AppImages report an unsupported installation mode.

## Linux hardware and session limits

- Only an **x86_64 AppImage** is published and validated. ARM and Raspberry Pi-class hardware can be evaluated with a source build, but there is no published or broadly validated ARM release. Do not assume a Raspberry Pi model is supported until it has been tested with the intended desktop, GPU driver, video formats, and resolution.
- Tilecast does not create or manage the Linux graphical session. The computer must already start X11, Wayland, a desktop environment, or a kiosk compositor before the player launches.
- Live screen preview is best on X11. On Wayland it depends on the screen-capture portal and may fall back to window capture that misses hardware-overlay video and website frames.
- Secure sandboxing for remote `web` declarative presentations is not yet implemented on Linux.
- Tilecast does not provide HDMI-CEC or TV sleep/wake assistance on Linux.

## Standard Reliability is not a hard kiosk

Standard Reliability can return to Tilecast with approved Accessibility Control, but Android may still allow a user to leave the app.

Only capability-confirmed device-owner lock task is labeled Managed Kiosk.

## No direct HDMI-CEC commands

Power Assist uses Android sleep and wake behavior. A device may relay that to a TV, but Tilecast does not send raw CEC commands.

Player wake does not prove TV power, input selection, or visible playback.

## No recovery from every physical failure

Tilecast cannot recover by itself from:

- unplugged or failed hardware
- power that is not restored
- changed Wi-Fi credentials
- captive-portal approval
- Android permission prompts
- a TV on the wrong input
- firmware that blocks boot launch

## Offline changes cannot arrive

Cached playback and previously received schedules continue offline.

An offline player cannot receive:

- newly uploaded content
- a new manifest
- a new emergency
- a new command
- a new update deployment

## One organization per installation

Tilecast is not multi-tenant. One installation manages one organization.

Run separate installations when organizations need separate owners, data, and security boundaries.

## Fixed command set

Player commands are typed and fixed. There is no arbitrary shell, SQL, executable, URL, or script command.

## Player updates are Tilecast Player only

The Player update system does not update:

- Tilecast Server
- Docker
- PostgreSQL
- the host operating system
- TV firmware
