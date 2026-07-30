# Google TV and Android TV testing

Standard Reliability operates without device-owner provisioning. It cannot prevent all users from leaving Tilecast.

Managed Kiosk requires compatible device-owner provisioning. This operation frequently occurs after a factory reset.

Power Assist gives best-effort control. An Android process wake does not show that the TV started or selected the input.

Use the Studio confirmation wizard for each screen. Record the device model and firmware.

Create an Android TV virtual device in Android Studio. Start the device.

Install the debug APK with `adb install -r`. Connect a physical Google TV device through wireless debugging or a supported USB connection.

Use the D-pad to test each action. Test manual address entry, back navigation, the pairing countdown, and the idle screen.

While the player is paired, test a server restart and a Wi-Fi interruption.

The application does not use touch-only gestures or Google Play Services.

Test custom branding, reporting intervals, and cache limits on the target Google TV device. Room keeps the configuration during an outage.

For GitHub APK updates, give Tilecast Player installation permission. Use **Settings > Apps > Special app access > Install unknown apps**.

On Android 12 and later, Tilecast requests unattended self-update mode. Tilecast starts again after the update.

Android can require confirmation when the device is not eligible. Menu labels are different for some manufacturers.

Physical Google TV update tests are not complete.
