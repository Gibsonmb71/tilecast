# Google TV and Android TV testing

Standard Reliability works without device-owner provisioning but cannot guarantee that users cannot leave Tilecast. Managed Kiosk requires compatible device-owner provisioning, often during factory-reset setup. Power Assist is best effort: Android process wake does not prove that the TV powered on or selected the input. Use Studio’s per-screen physical confirmation wizard and record the exact device and firmware.

Create an Android TV virtual device in Android Studio, boot it, and install the debug APK with `adb install -r`. A physical Google TV device can be connected through wireless debugging or USB where supported.

Use the D-pad to verify every action, manual address entry, back navigation, pairing countdown, and the idle screen. Test server restart and Wi-Fi interruption while the player is paired. The app does not use touch-only gestures or Google Play Services.

Validate custom branding, reporting intervals, and effective cache limits on the target Google TV device; configuration remains available from Room during outages.

For GitHub APK updates, allow Tilecast Player once under **Settings → Apps → Special app access → Install unknown apps**. On Android 12 and newer, Tilecast then requests Android's unattended self-update mode and relaunches after replacement. Android can still require confirmation when platform eligibility is not met. Exact labels vary by manufacturer. Physical Google TV unattended-update verification remains outstanding.
