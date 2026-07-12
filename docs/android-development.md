# Android player development

Tilecast Player requires JDK 17 and Android SDK 35. It uses the checked-in Gradle wrapper and has no Google Play Services dependency.

```sh
cd apps/player-android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. Build an unsigned, optimized release artifact with `./gradlew assembleRelease`. For distribution, configure a release keystore through local Gradle properties or CI secrets; never commit a keystore, alias password, or store password.

The single `org.tilecast.player` application ID is suitable for Play Store and direct APK distribution. Do not introduce Fire TV or Google TV variants unless a future store requirement cannot be handled through resources or manifest metadata.

Unit tests cover URL policy, state transitions, player-generated identity, secure-storage abstractions, pairing enrollment, revocation, and reconnect backoff. Instrumented tests require an emulator or device:

```sh
adb devices
./gradlew connectedDebugAndroidTest
```
