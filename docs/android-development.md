# Android player development

Tilecast Player requires JDK 17 and Android SDK 35. It uses the checked-in Gradle wrapper and has no Google Play Services dependency.

## Commissioning and unattended-recovery checks

Pairing a fresh installation enters the required commissioning wizard before playback. Emulator tests can exercise PIN storage, permission-state verification, unattended self-update policy selection, boot receiver registration, immersive/keep-awake reporting, cached-manifest checks, recovery escalation, and safe mode. They cannot prove firmware foreground-launch behavior, physical-TV wake/standby, or whether a vendor installer honors Android's unattended-update request.

Do not bypass commissioning in debug builds. For repeat testing, use **Run setup again** from the local maintenance menu. `BOOT_COMPLETED` and `LOCKED_BOOT_COMPLETED` recovery state is stored in device-protected preferences; watchdog crash history is stored independently of the activity so process recreation does not reset escalation.

```sh
cd apps/player-android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. Build an unsigned, optimized release artifact with `./gradlew assembleRelease`. For distribution, configure a release keystore through local Gradle properties or CI secrets; never commit a keystore, alias password, or store password.

The single `org.tilecast.player` application ID is suitable for Play Store and direct APK distribution. Do not introduce Fire TV or Google TV variants unless a future store requirement cannot be handled through resources or manifest metadata.

Calendar Sources are rendered by `CalendarPlayback.kt` from sanitized manifest data. The Player does not fetch ICS, receive feed URLs, or use WebView for calendar content. Manifest validation bounds event counts and text before activation; cached manifest startup preserves last-known-good prepared events.

RSS, Atom, JSON, and CSV Sources use manifest v8 and the native `StructuredSourcePlayback` renderer. The Player validates provider, presentation, record count, and text/value bounds before activation. It never fetches feed/data URLs, executes expressions, or routes structured Sources through WebView. Prepared records live in the verified cached manifest, so offline startup uses the same last-known-good data.

Manifest v9 adds native Clock, Date, QR Code, and Ticker Apps. Structured date selection runs locally against the configured IANA timezone and uses calendar arithmetic rather than 24-hour durations. The Player reevaluates while running and after process restart; `empty`, `hide`, `fallback_text`, and `next_available` do not silently reuse an old record. `last_known_good` is an explicit administrator choice.

Unit tests cover URL policy, state transitions, player-generated identity, secure-storage abstractions, pairing enrollment, revocation, and reconnect backoff. Instrumented tests require an emulator or device:

Milestone 4 uses Room schema version 2 and AndroidX Media3. `MIGRATION_1_2` preserves pairing configuration while adding manifest and cache metadata; media bytes live under the application-controlled `files/media-cache` directory. Startup loads verified active content before network reconciliation. Animated GIFs render a safe static frame because portable animation cannot be guaranteed across Fire TV and Google TV.

Milestone 5 keeps Room schema version 2 because schedule definitions live in the atomically stored manifest JSON. `ScheduleEngine` is isolated from Compose and evaluates with `java.time` timezone rules. Startup, manifest activation, foregrounding, clock/timezone broadcasts, and calculated transitions trigger reevaluation. Shared fixtures under `packages/manifest-schema` verify Go/Kotlin precedence parity.

Offline recovery verification should activate a Download-policy playlist, stop Tilecast or disconnect the network, force-stop and reopen the application, and confirm playback resumes. Stream-policy items are intentionally skipped while unavailable.

```sh
adb devices
./gradlew connectedDebugAndroidTest
```

Milestone 6 uses the system Android WebView through a dedicated website playback component. Test exact-host policy and safe configuration on the JVM; validate renderer behavior, D-pad focus, installed WebView versions, TLS failures, and process termination on the target emulator/device. Tilecast does not require Google Play Services or a Chrome-specific API.

Milestone 8 adds `PlayerConfigManager`, the validated source for effective branding, playback defaults, cache/download policy, and reporting intervals. Room schema 3 preserves current and previous valid configuration revisions independently of content manifests.

Production Player release signing is free and independent of app stores. Preserve one permanent Android keystore and a separate Ed25519 manifest key. Gradle reads signing values only from local environment variables, and `scripts/build-player-release.sh` fails closed when any secret is missing. See [player-updates.md](player-updates.md). Emulator/debug builds do not validate production-key replacement.
