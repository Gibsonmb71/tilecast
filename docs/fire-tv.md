# Fire TV sideloading

Fire OS firmware varies. Standard Reliability, cached startup, immersive mode, and optional Accessibility Control Assist must be verified on the target model. Fire TV may relay Android sleep/wake as HDMI-CEC standby or wake, but Tilecast does not send direct CEC commands and Studio requires a physical administrator confirmation. Device-owner Managed Kiosk is often unavailable on consumer Fire TV firmware; never label it active unless the player reports confirmed lock task. Keep Android Settings and the package installer excluded from Accessibility return behavior.

Enable Developer Options and ADB debugging on the Fire TV, note its LAN address, then connect and install:

```sh
adb connect FIRE_TV_ADDRESS:5555
adb install -r apps/player-android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p org.tilecast.player 1
```

Tilecast uses the standard Leanback launcher category, standard Android networking, NSD, Room, WorkManager, and Keystore. It does not require Google Play Services. Compilation alone is not physical Fire TV validation; each supported Fire OS generation still needs device testing before a compatibility claim.

Effective player configuration also uses ordinary authenticated HTTPS and Room persistence. Validate branding contrast and cache limits on each target Fire TV storage profile.

For GitHub APK updates, enable installation permission for Tilecast Player once in Fire TV settings. Fire OS versions based on Android 12 or newer may honor Tilecast's unattended self-update request; older Amazon installers can still require local confirmation. Accessibility Control never searches for or clicks installer buttons. Fully headless older Fire TV deployments require managed/device-owner provisioning or a firmware-supported installer path. Menu names vary by Fire OS release. Physical Fire TV unattended-update verification remains outstanding.
