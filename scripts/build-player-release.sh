#!/usr/bin/env bash
set -euo pipefail

: "${TILECAST_ANDROID_KEYSTORE_PATH:?Set TILECAST_ANDROID_KEYSTORE_PATH}"
: "${TILECAST_ANDROID_KEYSTORE_PASSWORD:?Set TILECAST_ANDROID_KEYSTORE_PASSWORD}"
: "${TILECAST_ANDROID_KEY_ALIAS:?Set TILECAST_ANDROID_KEY_ALIAS}"
: "${TILECAST_ANDROID_KEY_PASSWORD:?Set TILECAST_ANDROID_KEY_PASSWORD}"
: "${TILECAST_UPDATE_MANIFEST_PRIVATE_KEY:?Set TILECAST_UPDATE_MANIFEST_PRIVATE_KEY}"

CHANNEL="${TILECAST_RELEASE_CHANNEL:-stable}"
NOTES="${TILECAST_RELEASE_NOTES:-Tilecast Player release}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${TILECAST_RELEASE_OUTPUT:-$ROOT/release-output}"
mkdir -p "$OUTPUT"

cd "$ROOT/apps/player-android"
./gradlew clean assembleRelease
APK="$ROOT/apps/player-android/app/build/outputs/apk/release/app-release.apk"
test -f "$APK"
APKSIGNER="${ANDROID_HOME:?ANDROID_HOME is required}/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-35.0.0}/apksigner"
"$APKSIGNER" verify --verbose --print-certs "$APK"

VERSION_CODE="$(sed -n 's/.*versionCode = \([0-9][0-9]*\).*/\1/p' app/build.gradle.kts | head -1)"
VERSION_NAME="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' app/build.gradle.kts | head -1)"
APK_SIZE="$(wc -c < "$APK" | tr -d ' ')"
APK_SHA="$(shasum -a 256 "$APK" | awk '{print $1}')"
CERT_SHA="$("$APKSIGNER" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | tr -d ':' | tr '[:upper:]' '[:lower:]' | head -1)"
test -n "$VERSION_CODE" && test -n "$VERSION_NAME" && test -n "$CERT_SHA"

cp "$APK" "$OUTPUT/tilecast-player.apk"
jq -n --argjson versionCode "$VERSION_CODE" --arg versionName "$VERSION_NAME" --arg channel "$CHANNEL" --argjson size "$APK_SIZE" --arg sha "$APK_SHA" --arg cert "$CERT_SHA" --arg notes "$NOTES" '{schemaVersion:1,product:"tilecast-player",applicationId:"org.tilecast.player",versionCode:$versionCode,versionName:$versionName,channel:$channel,minimumSdk:23,apkAssetName:"tilecast-player.apk",apkSizeBytes:$size,apkSha256:$sha,signingCertificateSha256:$cert,releaseNotes:$notes}' > "$OUTPUT/tilecast-player-update.json"
openssl pkeyutl -sign -rawin -inkey "$TILECAST_UPDATE_MANIFEST_PRIVATE_KEY" -in "$OUTPUT/tilecast-player-update.json" | openssl base64 -A > "$OUTPUT/tilecast-player-update.json.sig"
openssl pkeyutl -verify -rawin -pubin -inkey "${TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_FILE:?Set TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_FILE}" -in "$OUTPUT/tilecast-player-update.json" -sigfile <(openssl base64 -d -A -in "$OUTPUT/tilecast-player-update.json.sig")
echo "Created signed Tilecast Player $VERSION_NAME ($VERSION_CODE) release assets in $OUTPUT"
