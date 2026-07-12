# GitHub Player updates

Tilecast distributes Tilecast Player as signed APKs through published releases at `Gibsonmb71/tilecast`. No Google Play, Amazon Developer, or paid Android developer account is required. Android and Fire OS can require an administrator at the TV to allow unknown-app installation and approve the system installer; Tilecast does not automate those prompts.

## Release contract

Every stable release, and every GitHub prerelease used as the beta channel, must contain exactly named assets:

- `tilecast-player.apk`
- `tilecast-player-update.json`
- `tilecast-player-update.json.sig`

The schema-1 JSON identifies `tilecast-player`, application ID `org.tilecast.player`, version code/name, stable or beta channel, minimum SDK 23, APK name/size/SHA-256, signing-certificate SHA-256, and release notes. The signature is base64 Ed25519 over the exact JSON bytes. The server trusts only `TILECAST_UPDATE_MANIFEST_PUBLIC_KEY`; the private key is never installed on Tilecast Server.

Drafts, arbitrary repositories, arbitrary asset names/URLs, invalid signatures, downgrades, incompatible SDK declarations, checksum mismatches, invalid APK signatures, and signing-certificate mismatches are rejected. A verified APK is streamed to a temporary file beneath `/data/updates`, checked, and atomically renamed. Players download only from their paired Tilecast server using authenticated range requests.

## Permanent signing keys

Create the Android key once and preserve secure offline backups:

```sh
keytool -genkeypair -keystore tilecast-player-production.jks -alias tilecast-player -keyalg RSA -keysize 4096 -validity 10000
openssl genpkey -algorithm Ed25519 -out tilecast-update-private.pem
openssl pkey -in tilecast-update-private.pem -pubout -out tilecast-update-public.pem
openssl pkey -pubin -in tilecast-update-public.pem -outform DER | tail -c 32 | openssl base64 -A
```

Never rotate the Android signing key casually: Android accepts an APK update only when its signing identity matches the installed application. Never commit either private key, keystore, aliases, passwords, signed APKs, or GitHub tokens.

For a local signed build, set `TILECAST_ANDROID_KEYSTORE_PATH`, `TILECAST_ANDROID_KEYSTORE_PASSWORD`, `TILECAST_ANDROID_KEY_ALIAS`, `TILECAST_ANDROID_KEY_PASSWORD`, `TILECAST_UPDATE_MANIFEST_PRIVATE_KEY`, `TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_FILE`, `ANDROID_HOME`, and run `scripts/build-player-release.sh`. Outputs go to ignored `release-output/` unless overridden.

## GitHub Actions secrets

The `Tilecast Player Release` workflow requires `TILECAST_ANDROID_KEYSTORE_BASE64`, both Android key passwords, `TILECAST_ANDROID_KEY_ALIAS`, `TILECAST_UPDATE_MANIFEST_PRIVATE_KEY_PEM`, and `TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_PEM`. It refuses missing secrets and non-increasing version codes, builds and verifies the signed APK, derives metadata, signs and verifies the update manifest, verifies APK size/hash agreement, and publishes the three assets. Secret files exist only in the Actions runner temporary directory.

## Studio and player flow

Owners check/import releases and request caching under **Settings → Player Updates**. Owners and Administrators deploy a fully verified cached release to screens and/or groups. Group membership is resolved at deployment start and duplicates are removed. Modes are download only, install now, and maintenance window. Screen states distinguish downloading, verification, permission/user approval, installation, reconnecting, success, failure, cancellation, incompatibility, and already-current.

The player resumes `.part` downloads, verifies SHA-256, package name, version code, minimum SDK, and signing certificate, then uses Android `PackageInstaller`. Emergency playback delays installation but not downloading. Pairing credentials, manifests, configuration, disabled state, and media cache live outside the APK and survive replacement. Success is recorded only after the updated player reconnects and reports the expected version code.

An offline player cannot receive a new deployment. `WaitingForPermission` and `WaitingForUser` are expected operational states, not failures. Silent installation is not claimed. Physical Fire TV and Google TV validation remains required for each device/OS family.
