# Fire TV sideloading

Fire OS firmware is different on some models. Test these functions on each target model:

- Standard Reliability
- Cached startup
- Immersive mode
- Accessibility Control Assist

Fire TV can send Android sleep or wake events through HDMI-CEC. The Android
Player does not send direct CEC commands; Linux Display Control is a separate
host-only feature and does not apply to Fire TV.

Studio requires an administrator to confirm the physical result.

Consumer Fire TV firmware frequently does not support device-owner Managed Kiosk. Identify this mode as active only when the player confirms lock task.

Exclude Android Settings and the package installer from Accessibility return behavior.

Enable Developer Options and ADB debugging on the Fire TV. Record its LAN address.

Connect to the Fire TV and install the application:

```sh
adb connect FIRE_TV_ADDRESS:5555
adb install -r apps/player-android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p org.tilecast.player 1
```

Tilecast uses standard Android components. These components include Leanback, networking, NSD, Room, WorkManager, and Keystore.

Tilecast does not require Google Play Services.

A successful build does not validate a physical Fire TV. Test each supported Fire OS generation before you claim compatibility.

Player configuration uses authenticated HTTPS and Room storage. Test branding contrast and cache limits on each target Fire TV storage profile.

For GitHub APK updates, give Tilecast Player installation permission in Fire TV settings.

Fire OS versions based on Android 12 or later can permit unattended updates. Older Amazon installers can require local confirmation.

Accessibility Control does not find or select installer buttons.

An unattended older Fire TV requires device-owner management or a firmware installer. Menu names are different on some Fire OS releases.

Physical Fire TV update tests are not complete.
