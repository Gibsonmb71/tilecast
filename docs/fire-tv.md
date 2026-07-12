# Fire TV sideloading

Enable Developer Options and ADB debugging on the Fire TV, note its LAN address, then connect and install:

```sh
adb connect FIRE_TV_ADDRESS:5555
adb install -r apps/player-android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p org.tilecast.player 1
```

Tilecast uses the standard Leanback launcher category, standard Android networking, NSD, Room, WorkManager, and Keystore. It does not require Google Play Services. Compilation alone is not physical Fire TV validation; each supported Fire OS generation still needs device testing before a compatibility claim.
