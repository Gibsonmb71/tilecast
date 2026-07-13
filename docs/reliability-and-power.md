# Android reliability, kiosk, accessibility, and power

Tilecast Player has two reliability modes. **Standard Reliability** works with a normally installed APK and provides cached startup, boot recovery, immersive fullscreen, keep-awake behavior, bounded playback recovery, safe mode, and optional Accessibility Control Assist. Android can still let a user leave the app. **Managed Kiosk** is effective only when Android confirms device-owner/device-policy provisioning and active lock task. Requesting it in policy is not proof that it is active.

## Active hours

Active hours use explicit IANA timezones, ISO weekdays (Monday 1 through Sunday 7), and half-open `[start,end)` windows. An end at or before the start is overnight and belongs to the selected start day. Calendar calculations use timezone rules rather than fixed durations. In a DST gap, a boundary advances to the first valid local time; in an overlap, starts choose the earlier occurrence and ends the later occurrence. Emergency takeover overrides off-hours sleep and black-screen behavior. APK installation and required verification are never interrupted.

Outside active hours the player saves state, stops media decoding, releases keep-screen-on, pauses ordinary presentation, and uses a true-black fallback when Android sleep is unavailable. Cached configuration and manifests are used immediately after boot without waiting for the network.

## Power Assist, not direct CEC

Power Assist uses the Android device’s sleep and wake behavior. Compatible devices may send HDMI-CEC standby or One Touch Play commands to the connected TV. Tilecast does **not** send raw HDMI-CEC commands and cannot infer that the physical TV changed power or input merely because the Android process resumed.

Sleep strategy is capability ordered: authorized device policy, optional Accessibility global lock, then black screen. Wake is best effort through supported activity/alarm behavior. Studio’s per-screen wizard stores administrator-confirmed device sleep, TV standby, device wake, TV wake, input selection, and Tilecast startup separately. Results are device-specific, not universal compatibility claims.

## Accessibility Control Assist

Control Assist is disabled by default and must be enabled locally in Android Accessibility Settings. The service observes only foreground window/package changes. It can wait, return to Tilecast, and request Android’s global lock action for Power Assist. It cannot read window text, passwords, click controls, perform gestures, approve an installer, navigate Settings, or change network configuration.

Tilecast, Android Settings, package installers, permission controllers, captive portals, setup/system components, and configured maintenance apps are excluded. Automatic returns pause during player updates and maintenance. Attempts are bounded in a time window; exhausting the bound stops the loop until the window clears.

## Recovery and safe mode

The local supervisor escalates through retry, item skip, renderer recreation, controller recreation, activity restart, and a bounded number of process recoveries. Repeated failure enters safe mode instead of looping. Safe mode keeps pairing, networking, health reporting, commands, local maintenance, cache validation, and manual retry available; it does not delete content or credentials. Owners and Administrators can issue `retry_player_recovery` or `exit_safe_mode` persistent commands.

## Local maintenance and Managed Kiosk

The default hidden sequence is Back, Back, Up, Down, Select. The first use creates a 4–12 digit local PIN; only a salted PBKDF2-SHA256 hash is stored. Incorrect attempts are rate-limited and temporarily locked. A maintenance session is time bounded and exposes only fixed actions: Android network/settings pages, Accessibility Settings, unknown-app permission, safe-mode recovery, Tilecast restart, and return to playback. There is no shell or arbitrary app launcher.

Device-owner provisioning can require a factory reset plus ADB, QR, or firmware-specific enrollment during initial setup. Tilecast never attempts to silently convert an existing consumer TV. Installer and Settings access remain allowed only during deliberate update or maintenance flows, and kiosk state is restored afterward when the platform supports it.

## Verification limitations

Emulator tests validate policy, boot receiver registration, lock-task capability reporting, active hours, DST handling, watchdog bounds, exclusions, and UI state. They cannot validate TV standby, TV wake, HDMI input selection, or firmware-specific boot launch. Those results require per-model physical Fire TV and Google TV testing and administrator confirmation.
