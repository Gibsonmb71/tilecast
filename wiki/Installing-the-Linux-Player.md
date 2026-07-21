# Installing the Linux Player

This guide installs the published AppImage on an Intel or AMD Linux computer. The player needs a working graphical session and network access to the Tilecast server.

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
~/tilecast/tilecast-player.AppImage
```

Do not run the player as root.

### AppImage or FUSE error

Some distributions do not install the compatibility FUSE library by default. On Debian or Ubuntu, install the available FUSE 2 compatibility package:

```sh
sudo apt update
sudo apt install libfuse2
```

On newer Ubuntu releases the package may be named `libfuse2t64` instead.

For a temporary diagnostic run, AppImage can extract itself instead of mounting through FUSE:

```sh
~/tilecast/tilecast-player.AppImage --appimage-extract-and-run
```

Use the normal executable AppImage for a managed deployment. The extracted fallback is not the recommended self-update path.

## Connect and pair

On first launch, the player searches the local network for Tilecast servers. Select a discovered server or enter its address manually.

The address must include the scheme, for example:

```text
https://signage.example.org
```

For a local installation that intentionally uses HTTP:

```text
http://192.168.1.50:8080
```

After the server is accepted, the player displays a six-character pairing code.

1. Open Tilecast Studio.
2. Open the screen pairing or approval view.
3. Enter or approve the code shown on the display.
4. Name the screen and finish enrollment.
5. Assign content, a playlist, layout, or schedule.

The pairing session survives a player restart until it expires. After enrollment, the credential and installation identity persist across ordinary player upgrades.

## Supply the server address without typing

Set the server URL before launch:

```sh
TILECAST_SERVER_URL=https://signage.example.org \
  ~/tilecast/tilecast-player.AppImage
```

The player validates and saves the address. The same value can be placed in the systemd service environment for unattended provisioning.

The command-line equivalent is:

```sh
~/tilecast/tilecast-player.AppImage \
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
  ~/tilecast/tilecast-player.AppImage
```

The player creates sensitive state files with owner-only permissions. Protect the entire data directory as a device credential store.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TILECAST_SERVER_URL` | Server address; saved after first use |
| `TILECAST_DATA_DIR` | State and media-cache directory |
| `TILECAST_LOG_LEVEL=debug` | Verbose structured logs |
| `TILECAST_WINDOWED=1` | Disable kiosk fullscreen for testing |
| `TILECAST_HW_DECODE=0` | Disable Intel VA-API video decode |
| `TILECAST_DISABLE_GPU=1` | Force software rendering |
| `TILECAST_MAX_FPS=30` | Set the frame-rate cap |
| `TILECAST_PREVIEW_SCREEN_CAPTURE=0` | Disable framebuffer capture for live previews |
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

A development run is not considered a managed AppImage, so Studio-driven AppImage replacement reports an unsupported installation mode. Use a packaged AppImage for update testing.

Next: [Linux Kiosk and Autostart](Linux-Kiosk-and-Autostart)
