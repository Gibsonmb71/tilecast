# Android reliability, kiosk, accessibility, and power

Tilecast Player has two reliability modes. **Standard Reliability** works with a normally installed APK and provides cached startup, boot recovery, immersive fullscreen, keep-awake behavior, bounded playback recovery, safe mode, and locally approved Accessibility Control Assist. Android can still let a user leave the app. **Managed Kiosk** is effective only when Android confirms device-owner/device-policy provisioning and active lock task. Requesting it in policy is not proof that it is active.

## First-run commissioning

Every newly paired player completes a local wizard before normal playback. It sets the hashed maintenance PIN, opens and verifies Accessibility Settings and unknown-app installation permission, verifies a healthy boot return, confirms immersive and keep-awake state, confirms a downloadable cached fallback, runs a self-test, and reports the final readiness state. Protected Android settings are never automated or marked complete based only on policy. **Run setup again** is available from the bounded local maintenance menu.

New effective defaults request launch after boot, keep-awake, immersive presentation, accessibility return control, cached offline playback, recovery escalation, safe mode, and the stable update channel. Accessibility and unknown-app installation remain one-time local commissioning permissions. Eligible self-updates on Android 12 and newer can proceed unattended after commissioning. Sleep outside active hours remains off until configured.

## Active hours

Active hours use explicit IANA timezones, ISO weekdays (Monday 1 through Sunday 7), and half-open `[start,end)` windows. An end at or before the start is overnight and belongs to the selected start day. Calendar calculations use timezone rules rather than fixed durations. In a DST gap, a boundary advances to the first valid local time; in an overlap, starts choose the earlier occurrence and ends the later occurrence. Emergency takeover overrides off-hours sleep and black-screen behavior. APK installation and required verification are never interrupted.

Outside active hours the player saves state, stops media decoding, releases keep-screen-on, pauses ordinary presentation, and uses a true-black fallback when Android sleep is unavailable. Cached configuration and manifests are used immediately after boot without waiting for the network.

## Power Assist, not direct CEC

Power Assist uses the Android device’s sleep and wake behavior. Compatible devices may send HDMI-CEC standby or One Touch Play commands to the connected TV. Tilecast does **not** send raw HDMI-CEC commands and cannot infer that the physical TV changed power or input merely because the Android process resumed.

Sleep strategy is capability ordered: authorized device policy, optional Accessibility global lock, then black screen. Wake is best effort through supported activity/alarm behavior. Studio’s per-screen wizard stores administrator-confirmed device sleep, TV standby, device wake, TV wake, input selection, and Tilecast startup separately. Results are device-specific, not universal compatibility claims.

## Accessibility Control Assist

Control Assist is requested by the hardened default but remains disabled at the Android platform until it is enabled locally in Android Accessibility Settings. The service observes only foreground window/package changes. It can wait, return to Tilecast, and request Android’s global lock action for Power Assist. It cannot read window text, passwords, click controls, perform gestures, approve an installer, navigate Settings, or change network configuration.

Tilecast, Android Settings, package installers, permission controllers, captive portals, setup/system components, and configured maintenance apps are excluded. Automatic returns pause during player updates and maintenance. Attempts are bounded in a time window; exhausting the bound stops the loop until the window clears.

## Recovery and safe mode

The local supervisor persists failure and healthy-playback history across activity and process restarts. It executes retry, item skip, renderer recreation, playback-session recreation, activity restart, and a bounded number of process recoveries. Failure history clears only after a meaningful healthy-playback period. Repeated failure enters safe mode instead of looping. Safe mode keeps pairing, networking, health reporting, commands, local maintenance, cache validation, and manual retry available; it does not delete content or credentials. Owners and Administrators can issue typed commands for each recovery rung, resynchronize manifest and configuration, run a self-test, retry recovery, or exit safe mode.

Boot recovery registers both normal and locked boot completion. It requests an immediate foreground launch and retries after bounded 15, 60, and 180 second delays, stopping after a healthy foreground is confirmed. Firmware may block background activity launch; that limitation is reported to Studio rather than hidden.

Network, heartbeat, command, manifest, and configuration failures do not clear cached playback. Reconnection uses bounded exponential backoff with jitter while the active manifest and local schedules continue; the backoff resets once a connection has stayed healthy long enough, so a brief blip after a stable session reconnects quickly instead of resuming near the cap. A prolonged loss of server contact escalates only when the screen has nothing to present: after a couple of minutes it re-verifies cached fallback content, and if it remains blank and offline it restarts the activity and finally the process. A screen still showing cached content while offline is never disrupted. Connection loss, recovery, and offline self-heal actions are reported as reliability activity events (connectivity and reliability categories) so Studio can see them per screen. Complete hardware failure, power that is not restored, changed Wi-Fi credentials, and Android prompts that require approval remain outside zero-touch recovery.

## Local maintenance and Managed Kiosk

The default hidden sequence is Back, Back, Up, Down, Select. The first use creates a 4–12 digit local PIN; only a salted PBKDF2-SHA256 hash is stored. Incorrect attempts are rate-limited and temporarily locked. A maintenance session is time bounded and exposes only fixed actions: Android network/settings pages, Accessibility Settings, unknown-app permission, safe-mode recovery, Tilecast restart, and return to playback. There is no shell or arbitrary app launcher.

Device-owner provisioning can require a factory reset plus ADB, QR, or firmware-specific enrollment during initial setup. Tilecast never attempts to silently convert an existing consumer TV. Installer and Settings access remain allowed only during deliberate update or maintenance flows, and kiosk state is restored afterward when the platform supports it.

## Verification limitations

Emulator tests validate policy, boot receiver registration, lock-task capability reporting, active hours, DST handling, watchdog bounds, exclusions, and UI state. They cannot validate TV standby, TV wake, HDMI input selection, or firmware-specific boot launch. Those results require per-model physical Fire TV and Google TV testing and administrator confirmation.
