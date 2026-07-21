# Player Updates

Tilecast can verify, cache, and deploy signed Tilecast Player releases for both platforms: Android APK releases and Linux AppImage releases. Players download from their paired Tilecast server, not from GitHub.

Releases are matched to screens by platform. An Android deployment targets only Android screens; a Linux deployment targets only Linux screens. The verification pipeline, deployment modes, rollout, and state machine are shared.

Android and Fire OS can still require a person at the TV to approve installation. Linux self-updates apply without a prompt when the player runs as a managed AppImage.

## Server trust configuration

Before importing releases, configure the raw Ed25519 public key:

```dotenv
TILECAST_UPDATE_MANIFEST_PUBLIC_KEY=BASE64_RAW_PUBLIC_KEY
```

Restart Tilecast after changing deployment configuration.

The manifest private key and Android signing keystore must never be installed on Tilecast Server.

## Release files

An Android release bundle contains exactly:

```text
tilecast-player.apk
tilecast-player-update.json
tilecast-player-update.json.sig
```

A Linux release bundle contains exactly:

```text
tilecast-player.AppImage
tilecast-player-update-linux.json
tilecast-player-update-linux.json.sig
```

Both manifests are signed with the same Ed25519 key. Tilecast verifies, per platform:

- Ed25519 manifest signature
- product and platform
- version code and version name
- stable or beta channel
- artifact filename and size
- artifact SHA-256
- downgrade protection

Android additionally verifies application ID `org.tilecast.player`, minimum Android SDK, the Android signing-certificate SHA-256, and signing-identity continuity. Linux trusts the signed manifest's SHA-256, verified on download, and has no SDK or signing-certificate check.

Invalid or incompatible releases are rejected before deployment.

## Add a release to Studio

Owners can use **Settings → Player updates**.

### Sync from GitHub

Tilecast checks the fixed [Gibsonmb71/tilecast Releases](https://github.com/Gibsonmb71/tilecast/releases) source.

`TILECAST_GITHUB_TOKEN` is optional and only raises GitHub API rate limits.

### Upload release

Upload one platform's bundle together: for Android, the APK, JSON manifest, and signature; for Linux, the AppImage, Linux JSON manifest, and signature.

Direct upload and GitHub sync use the same verification pipeline and create the same Player release record. GitHub availability is not required for deployment.

## Deploy a release

Owners and Administrators can target screens, groups, or both.

Deployment modes:

- **Download only**
- **Install now**
- **Maintenance window**

Group membership is resolved when the deployment starts. Duplicate screens are removed from the target set.

## Deployment states

Studio distinguishes:

- downloading
- verifying
- waiting for install permission
- waiting for user approval
- installing
- reconnecting
- success
- failure
- canceled
- incompatible
- already current

`WaitingForPermission` and `WaitingForUser` are expected states, not automatic failures.

## Canary rollout

A deployment can begin with a deterministic canary cohort.

Other screens remain held until every canary reconnects successfully. The rollout pauses if a canary:

- reports failure
- enters safe mode
- remains reconnecting past the health window

Review the pause reason before continuing.

## Player-side checks

Before installation, Player checks:

- available storage
- complete resumed download
- artifact SHA-256 (APK or AppImage)
- version code
- emergency state
- Android only: package name, minimum SDK, signing certificate, and install permission
- Linux only: that it is running as a managed AppImage that can be replaced

An active emergency delays installation but does not prevent download.

Pairing credentials, manifests, configuration, disabled state, and media cache live outside the artifact and survive replacement. On Linux the player replaces the running AppImage and relaunches under systemd; on Android it installs the signed APK.

Success is recorded only after the updated Player reconnects with the expected version and reports healthy playback.

## Publishing releases

Release publishers should follow the repository's [Player update contract](https://github.com/Gibsonmb71/tilecast/blob/main/docs/player-updates.md). Do not rotate the Android signing key casually. Android rejects an update signed with a different identity.
