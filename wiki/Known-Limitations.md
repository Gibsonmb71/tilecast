# Known Limitations

Tilecast reports platform limits instead of presenting them as completed capabilities.

## Layout capabilities

Playback supports published multi-zone Layouts and fullscreen playlists.

A Layout has a maximum of one active video zone and one audio zone. Tilecast does not support other simultaneous-video compositions.

Not currently supported:

- multi-zone layouts
- compositions
- simultaneous independent videos
- arbitrary HTML layout builders

The **Layouts** route in Studio is available for creating and publishing supported Layouts.

## What Activity reporting can and cannot tell you

Tilecast does report proof of play: a Player confirms what it displayed, and Activity derives playback sessions from those reports. An assignment or a schedule is never treated as proof that anything appeared on a screen.

Review these limits before you use an Activity value. The [Activity documentation](https://github.com/tilecast/tilecast/blob/main/docs/activity.md#known-limitations) contains the full list.

- **Playback compliance is not retroactive.** Expectations are recorded as they happen, so compliance over a period before this feature existed reports little or no expected time. It says "No data" rather than inventing a percentage.
- **A screen can read healthy seconds after it broke.** Fleet health reflects the last heartbeat and status. Use the per-screen timeline or incidents for what actually happened.
- **"Interrupted plays" is a floor, not a total.** Sessions recorded by an older Player usually have no recorded reason for ending, and are excluded rather than guessed at.
- **Some conditions cannot be detected on every device.** A Player that cannot measure screen brightness or frame changes never reports a black or frozen screen. No such event is not proof that the screen is fine.
- **Cause is often genuinely unknown.** When a screen stops reporting, Tilecast knows that it stopped. It does not know whether the cause was the network, the power, or the device, and it says "Unknown cause" instead of guessing.
- **Telemetry gaps are not recovered.** Tilecast cannot recover detailed telemetry from an offline period.
- The Player buffers and retries proof-of-play and Activity events. It does not buffer telemetry during a long outage.

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

Linux updates replace the active AppImage without a prompt. This operation requires a managed AppImage.

The supported `--appimage-extract-and-run` mode keeps the managed state. Development runs and manually unpacked AppImages report an unsupported installation mode.

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
