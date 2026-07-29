# Install Tilecast Player

Tilecast Player runs on two kinds of device:

- **Android TV devices** — Fire TV, Google TV, and Android TV, without Google Play Services. Installed as an APK with package ID `org.tilecast.player`.
- **Linux computers** — 64-bit Intel or AMD machines with a graphical session. Installed as an AppImage.

Both builds pair, play, schedule, and update the same way. Pick your platform below. First-launch pairing is shared and described at the end of this page.

---

# Android TV, Fire TV, and Google TV

## Choose an APK

### Published release

For a published release, download `tilecast-player.apk` from the repository's [Releases page](https://github.com/Gibsonmb71/tilecast/releases).

Release assets used by Tilecast's update system are:

- `tilecast-player.apk`
- `tilecast-player-update.json`
- `tilecast-player-update.json.sig`

Only the APK is installed directly on the TV. The JSON and signature are used by Tilecast Server to verify a release before deployment.

### Local development build

From the repository root:

```sh
cd apps/player-android
./gradlew assembleDebug
```

The debug APK is written to:

```text
apps/player-android/app/build/outputs/apk/debug/app-debug.apk
```

A debug build is for testing. Production update compatibility depends on preserving the Android signing identity used for the installed application.

## Fire TV

Enable Developer Options and ADB debugging, note the Fire TV's LAN address, then run:

```sh
adb connect FIRE_TV_ADDRESS:5555
adb install -r tilecast-player.apk
adb shell monkey -p org.tilecast.player 1
```

For a local debug build, replace `tilecast-player.apk` with the path to `app-debug.apk`.

Fire OS menus and supported management features vary by model and firmware. Consumer Fire TV firmware commonly supports Standard Reliability but may not support device-owner Managed Kiosk.

## Google TV and Android TV

Use wireless debugging, USB debugging, or another manufacturer-supported ADB connection:

```sh
adb devices
adb install -r tilecast-player.apk
adb shell monkey -p org.tilecast.player 1
```

Every action in Tilecast Player is designed for D-pad navigation. Verify focus and Back behavior with the actual remote.

## Permission for future updates (Android)

Android and Fire OS normally require local approval before an app can install an APK.

After pairing, the commissioning wizard opens the appropriate **Install unknown apps** screen when update support is configured. Approve Tilecast Player, then return to the app.

Tilecast does not use ADB, simulated clicks, root, or hidden APIs to bypass the system installer.

---

# Linux

This installs the published AppImage on an Intel or AMD Linux computer. The player needs a working graphical session and network access to the Tilecast server.

The automated release process publishes an **x86_64 AppImage** named `tilecast-player.AppImage`. That is the recommended format for Intel and AMD Linux signage computers. ARM and Raspberry Pi-class hardware can be evaluated with a source build, but there is no separately published or broadly validated ARM release yet — see [[Known Limitations]].

## Before you begin

You need:

- A 64-bit x86 Linux installation
- An X11 or Wayland graphical session
- A keyboard for initial setup, unless the server URL is supplied in advance
- The HTTPS or local HTTP address of the Tilecast server
- Permission in Tilecast Studio to approve and configure a screen

X11 is currently the simplest choice for unattended signage because live screen previews do not require the Wayland screen-capture portal.

## Download and launch the AppImage

Download `tilecast-player.AppImage` from the latest **Tilecast Player for Linux** release, then place it in a permanent location:

```sh
mkdir -p ~/tilecast
mv ~/Downloads/tilecast-player.AppImage ~/tilecast/
chmod +x ~/tilecast/tilecast-player.AppImage
~/tilecast/tilecast-player.AppImage --appimage-extract-and-run
```

Do not run the player as root.

### FUSE-independent startup

Current Tilecast releases use a static AppImage runtime and do not depend on the older FUSE 2 compatibility library. The managed service also uses AppImage's supported `--appimage-extract-and-run` mode as a safety net for older artifacts and hosts where filesystem mounting is unavailable. The runtime still identifies the original artifact through `$APPIMAGE`, so signed Studio updates can replace it normally.

Tilecast Linux Player 0.5.0 and older used the legacy runtime. If one of those releases reports a FUSE error, launch it with the managed command above once, then update to a newer release. Installing `libfuse2` or, on newer Ubuntu releases, `libfuse2t64` remains an alternative for legacy artifacts.

Do not manually unpack `squashfs-root` and run `AppRun`; that loses the managed AppImage identity used for updates.

## Supply the server address without typing

Set the server URL before launch:

```sh
TILECAST_SERVER_URL=https://signage.example.org \
  ~/tilecast/tilecast-player.AppImage --appimage-extract-and-run
```

The player validates and saves the address. The same value can be placed in the systemd service environment for unattended provisioning (see [[Reliability and Kiosk]]).

The command-line equivalent is:

```sh
~/tilecast/tilecast-player.AppImage \
  --appimage-extract-and-run \
  --server-url https://signage.example.org
```

## Player data

By default, state and cached content are stored in:

```text
~/.local/share/tilecast-player
```

This directory contains the installation identity, server address, credential, pairing state, cached manifest, downloaded media, configuration, command state, and watchdog state. Keep it when upgrading the AppImage.

To use another location:

```sh
TILECAST_DATA_DIR=/path/to/player-data \
  ~/tilecast/tilecast-player.AppImage --appimage-extract-and-run
```

The player creates sensitive state files with owner-only permissions. Protect the entire data directory as a device credential store.

## Environment variables (Linux)

| Variable                            | Purpose                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `TILECAST_SERVER_URL`               | Server address; saved after first use                       |
| `TILECAST_DATA_DIR`                 | State and media-cache directory                             |
| `TILECAST_LOG_LEVEL=debug`          | Verbose structured logs                                     |
| `TILECAST_WINDOWED=1`               | Disable kiosk fullscreen for testing                        |
| `TILECAST_HW_DECODE=0`              | Disable Intel VA-API video decode                           |
| `TILECAST_DISABLE_GPU=1`            | Force software rendering                                    |
| `TILECAST_MAX_FPS=30`               | Set the frame-rate cap                                      |
| `TILECAST_PREVIEW_SCREEN_CAPTURE=0` | Disable framebuffer capture for live previews               |
| `TILECAST_PREVIEW_SCREEN_CAPTURE=1` | Force framebuffer capture; Wayland may show a portal prompt |

## Build from source

A source build is useful for development and hardware evaluation. Node.js 22 or later and npm are required.

```sh
git clone https://github.com/Gibsonmb71/tilecast.git
cd tilecast
npm ci
npm run player:linux
```

Create local Linux packages with:

```sh
npm run player:linux:dist
```

Electron Builder writes the AppImage and Debian package under `apps/player-linux/dist/`.

A development run is not a managed AppImage, so Studio-driven AppImage replacement reports an unsupported installation mode. Use a packaged AppImage for update testing.

After first launch and pairing, configure the systemd service and kiosk session in [[Reliability and Kiosk]].

---

# First launch and pairing

On first launch, both builds:

1. Create a stable local installation identity.
2. Let you select a discovered Tilecast server or enter one manually.
3. Verify the server installation identity.
4. Create a short-lived pairing request.
5. Display a six-character code.

Continue with [[Pair a Screen]].

## Server address rules

- Public hostnames require HTTPS.
- Plain HTTP is accepted only for private IPv4 addresses, link-local addresses, localhost, and `.local` names.
- Explicit ports are preserved.
- The player never silently downgrades HTTPS to HTTP.

If LAN discovery fails, enter the URL manually. Discovery is only a convenience.

## Do not claim support from installation alone

Installing successfully does not verify launch after power restoration, kiosk lockdown, standby and wake, HDMI input selection, unattended updates, or firmware-specific recovery.

Complete [[Reliability and Kiosk]] on every device model and firmware family — including the systemd and kiosk-session setup for Linux screens.
