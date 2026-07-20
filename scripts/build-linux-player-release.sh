#!/usr/bin/env bash
set -euo pipefail

# Builds the Linux (AppImage) Tilecast Player release artifacts: the AppImage,
# a signed update manifest, and its detached Ed25519 signature. Mirrors
# scripts/build-player-release.sh (Android) but for the AppImage self-update
# channel consumed by the dashboard and the Linux player.

: "${TILECAST_UPDATE_MANIFEST_PRIVATE_KEY:?Set TILECAST_UPDATE_MANIFEST_PRIVATE_KEY}"

CHANNEL="${TILECAST_RELEASE_CHANNEL:-stable}"
NOTES="${TILECAST_RELEASE_NOTES:-Tilecast Player release}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${TILECAST_RELEASE_OUTPUT:-$ROOT/release-output}"
mkdir -p "$OUTPUT"

# Build the AppImage (tsc + electron-builder --linux).
npm run player:linux:dist --prefix "$ROOT"

DIST="$ROOT/apps/player-linux/dist"
APPIMAGE="$(find "$DIST" -maxdepth 1 -type f -name '*.AppImage' | head -1)"
if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
	echo "No AppImage was produced under $DIST." >&2
	exit 1
fi

VERSION_NAME="$(node -p "require('$ROOT/apps/player-linux/package.json').version")"
if ! [[ "$VERSION_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
	echo "package.json version '$VERSION_NAME' is not a semantic version." >&2
	exit 1
fi

# Derive a monotonic numeric version code from the semver, matching
# parseVersionCode() in the Linux player and the server's ordering.
IFS='.' read -r MAJOR MINOR PATCH _ <<<"${VERSION_NAME%%[-+]*}"
VERSION_CODE=$(((10#$MAJOR) * 1000000 + (10#$MINOR) * 1000 + (10#$PATCH)))
if [ "$VERSION_CODE" -le 0 ]; then
	echo "Derived version code must be positive (got $VERSION_CODE)." >&2
	exit 1
fi

ARTIFACT_SIZE="$(wc -c <"$APPIMAGE" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then
	ARTIFACT_SHA="$(sha256sum "$APPIMAGE" | awk '{print $1}')"
else
	ARTIFACT_SHA="$(shasum -a 256 "$APPIMAGE" | awk '{print $1}')"
fi

cp "$APPIMAGE" "$OUTPUT/tilecast-player.AppImage"
jq -n \
	--argjson versionCode "$VERSION_CODE" \
	--arg versionName "$VERSION_NAME" \
	--arg channel "$CHANNEL" \
	--argjson size "$ARTIFACT_SIZE" \
	--arg sha "$ARTIFACT_SHA" \
	--arg notes "$NOTES" \
	'{schemaVersion:1,product:"tilecast-player",platform:"linux",versionCode:$versionCode,versionName:$versionName,channel:$channel,artifactAssetName:"tilecast-player.AppImage",artifactSizeBytes:$size,artifactSha256:$sha,releaseNotes:$notes}' \
	>"$OUTPUT/tilecast-player-update-linux.json"

openssl pkeyutl -sign -rawin -inkey "$TILECAST_UPDATE_MANIFEST_PRIVATE_KEY" \
	-in "$OUTPUT/tilecast-player-update-linux.json" |
	openssl base64 -A >"$OUTPUT/tilecast-player-update-linux.json.sig"

openssl pkeyutl -verify -rawin -pubin \
	-inkey "${TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_FILE:?Set TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_FILE}" \
	-in "$OUTPUT/tilecast-player-update-linux.json" \
	-sigfile <(openssl base64 -d -A -in "$OUTPUT/tilecast-player-update-linux.json.sig")

echo "Created signed Tilecast Player $VERSION_NAME ($VERSION_CODE) Linux release assets in $OUTPUT"
