# Google TV and Android TV testing

Create an Android TV virtual device in Android Studio, boot it, and install the debug APK with `adb install -r`. A physical Google TV device can be connected through wireless debugging or USB where supported.

Use the D-pad to verify every action, manual address entry, back navigation, pairing countdown, and the idle screen. Test server restart and Wi-Fi interruption while the player is paired. The app does not use touch-only gestures or Google Play Services.

Validate custom branding, reporting intervals, and effective cache limits on the target Google TV device; configuration remains available from Room during outages.

For GitHub APK updates, allow Tilecast Player under **Settings → Apps → Special app access → Install unknown apps**, return to Tilecast, and approve the system installer. Exact labels vary by manufacturer. Physical Google TV update verification remains outstanding.
