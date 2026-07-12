# Android player development

Tilecast Player requires JDK 17 and Android SDK 35. It uses the checked-in Gradle wrapper and has no Google Play Services dependency.

```sh
cd apps/player-android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. Build an unsigned, optimized release artifact with `./gradlew assembleRelease`. For distribution, configure a release keystore through local Gradle properties or CI secrets; never commit a keystore, alias password, or store password.

The single `org.tilecast.player` application ID is suitable for Play Store and direct APK distribution. Do not introduce Fire TV or Google TV variants unless a future store requirement cannot be handled through resources or manifest metadata.

Unit tests cover URL policy, state transitions, player-generated identity, secure-storage abstractions, pairing enrollment, revocation, and reconnect backoff. Instrumented tests require an emulator or device:

Milestone 4 uses Room schema version 2 and AndroidX Media3. `MIGRATION_1_2` preserves pairing configuration while adding manifest and cache metadata; media bytes live under the application-controlled `files/media-cache` directory. Startup loads verified active content before network reconciliation. Animated GIFs render a safe static frame because portable animation cannot be guaranteed across Fire TV and Google TV.

Milestone 5 keeps Room schema version 2 because schedule definitions live in the atomically stored manifest JSON. `ScheduleEngine` is isolated from Compose and evaluates with `java.time` timezone rules. Startup, manifest activation, foregrounding, clock/timezone broadcasts, and calculated transitions trigger reevaluation. Shared fixtures under `packages/manifest-schema` verify Go/Kotlin precedence parity.

Offline recovery verification should activate a Download-policy playlist, stop Tilecast or disconnect the network, force-stop and reopen the application, and confirm playback resumes. Stream-policy items are intentionally skipped while unavailable.

```sh
adb devices
./gradlew connectedDebugAndroidTest
```
