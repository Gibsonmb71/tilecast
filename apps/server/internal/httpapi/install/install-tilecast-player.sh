#!/usr/bin/env bash
set -eu

# Tilecast Player provisioning for Debian-family Linux signage boxes.
#
# Served by the Tilecast server, which substitutes its own address below, so a
# signage box only ever talks to the server an operator already trusts. Nothing
# here contacts GitHub: the AppImage, its checksum, and the optional AirPlay
# provisioning script all come from the server.
#
#   curl -fsSL https://tilecast.example.org/install.sh | sudo bash
#
# The run is idempotent. Re-running it upgrades the AppImage in place, repairs
# the service, and re-checks AirPlay support.

readonly SERVER_URL="__TILECAST_SERVER_URL__"

WITH_AIRPLAY=1
WITH_PRESENTATION_NETWORK=1
KIOSK_USER=""
CREATE_USER=0

usage() {
  cat <<'USAGE'
Usage: install-tilecast-player.sh [options]

  --user NAME        Kiosk account to install for. Defaults to the account that
                     invoked sudo, or "tilecast" when run as root directly.
  --create-user      Create the kiosk account if it does not exist.
  --without-airplay  Skip AirPlay dependency provisioning.
  --without-presentation-network
                     Skip the Presentation Network helper, which lets a supported
                     Linux player temporarily join Wi-Fi for AirPlay while
                     Ethernet stays its primary Tilecast connection.
  --help             Show this message.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user)
      [ "$#" -ge 2 ] || { echo "--user needs a value." >&2; exit 2; }
      KIOSK_USER="$2"
      shift 2
      ;;
    --create-user)
      CREATE_USER=1
      shift
      ;;
    --without-airplay)
      WITH_AIRPLAY=0
      shift
      ;;
    --without-presentation-network)
      WITH_PRESENTATION_NETWORK=0
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root: curl -fsSL ${SERVER_URL}/install.sh | sudo bash" >&2
  exit 1
fi

if [ "$(uname -m)" != "x86_64" ]; then
  echo "The Tilecast Linux Player is published for x86_64; this machine is $(uname -m)." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

# Resolve the kiosk account before anything is written, so a typo fails here
# rather than half way through an install.
if [ -z "${KIOSK_USER}" ]; then
  KIOSK_USER="${SUDO_USER:-tilecast}"
fi
if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  if [ "${CREATE_USER}" -ne 1 ]; then
    echo "User ${KIOSK_USER} does not exist. Pass --user NAME for an existing account, or --create-user." >&2
    exit 1
  fi
  useradd --create-home --shell /bin/bash "${KIOSK_USER}"
  echo "Created kiosk account ${KIOSK_USER}."
fi
if [ "${KIOSK_USER}" = "root" ]; then
  echo "Install for an unprivileged kiosk account, not root. Pass --user NAME." >&2
  exit 1
fi

KIOSK_HOME="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"
if [ -z "${KIOSK_HOME}" ] || [ ! -d "${KIOSK_HOME}" ]; then
  echo "Home directory for ${KIOSK_USER} was not found." >&2
  exit 1
fi

echo "Installing Tilecast Player for ${KIOSK_USER} from ${SERVER_URL}"

# ---------------------------------------------------------------- AppImage

release_json="$(curl -fsS "${SERVER_URL}/api/v1/install/linux" 2>/dev/null || true)"
if [ -z "${release_json}" ]; then
  cat >&2 <<EOF
${SERVER_URL} has no cached Linux player release to install.

In Studio, open Settings -> Player releases, then download the newest Linux
release so this server can serve it. Re-run this installer afterwards.
EOF
  exit 1
fi

json_field() {
  printf '%s' "${release_json}" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" | head -n 1
}

VERSION_NAME="$(json_field versionName)"
EXPECTED_SHA="$(json_field sha256)"
if [ -z "${EXPECTED_SHA}" ]; then
  echo "The server did not report a checksum for the Linux release." >&2
  exit 1
fi

install_dir="${KIOSK_HOME}/tilecast"
appimage="${install_dir}/tilecast-player.AppImage"
install -d -o "${KIOSK_USER}" -g "${KIOSK_USER}" -m 0755 "${install_dir}"

download="$(mktemp "${install_dir}/.tilecast-player.XXXXXX")"
cleanup() {
  rm -f -- "${download}"
}
trap cleanup EXIT

echo "Downloading player ${VERSION_NAME:-release}..."
curl -fSL --progress-bar -o "${download}" "${SERVER_URL}/api/v1/install/linux/artifact"

actual_sha="$(sha256sum "${download}" | cut -d' ' -f1)"
if [ "${actual_sha}" != "${EXPECTED_SHA}" ]; then
  echo "Checksum mismatch: expected ${EXPECTED_SHA}, got ${actual_sha}." >&2
  exit 1
fi

# Replace in place. The service's ExecStart path never changes, so an upgrade
# is a move rather than a reinstall, and the AppImage identity that signed
# Studio updates depend on is preserved.
chown "${KIOSK_USER}:${KIOSK_USER}" "${download}"
chmod 0755 "${download}"
mv -f "${download}" "${appimage}"
trap - EXIT
echo "Installed ${appimage} (${VERSION_NAME:-unknown version})."

# ----------------------------------------------------------------- service

unit_dir="${KIOSK_HOME}/.config/systemd/user"
install -d -o "${KIOSK_USER}" -g "${KIOSK_USER}" -m 0755 "${KIOSK_HOME}/.config" "${KIOSK_HOME}/.config/systemd" "${unit_dir}"

curl -fsS -o "${unit_dir}/tilecast-player.service" "${SERVER_URL}/install/tilecast-player.service"
chown "${KIOSK_USER}:${KIOSK_USER}" "${unit_dir}/tilecast-player.service"

# The server address is set here so the box boots straight to the pairing code
# instead of asking an installer to type a URL on a TV with no keyboard.
override_dir="${unit_dir}/tilecast-player.service.d"
install -d -o "${KIOSK_USER}" -g "${KIOSK_USER}" -m 0755 "${override_dir}"
cat >"${override_dir}/10-server.conf" <<EOF
[Service]
Environment=TILECAST_SERVER_URL=${SERVER_URL}
EOF
chown "${KIOSK_USER}:${KIOSK_USER}" "${override_dir}/10-server.conf"

# Linger is what makes the player start at boot without anyone logging in.
loginctl enable-linger "${KIOSK_USER}"

run_as_kiosk() {
  local uid
  uid="$(id -u "${KIOSK_USER}")"
  runuser -u "${KIOSK_USER}" -- env "XDG_RUNTIME_DIR=/run/user/${uid}" "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" "$@"
}

if run_as_kiosk systemctl --user daemon-reload 2>/dev/null; then
  run_as_kiosk systemctl --user enable tilecast-player.service >/dev/null 2>&1 || true
  SERVICE_READY=1
else
  # No user bus yet (a fresh account that has never logged in). The unit is on
  # disk and linger is enabled, so it comes up with the graphical session.
  SERVICE_READY=0
fi

# ------------------------------------------------------------------ AirPlay

AIRPLAY_RESULT="skipped"
if [ "${WITH_AIRPLAY}" -eq 1 ]; then
  echo "Provisioning AirPlay support (use --without-airplay to skip)..."
  airplay_script="$(mktemp /tmp/tilecast-airplay.XXXXXX.sh)"
  if curl -fsS -o "${airplay_script}" "${SERVER_URL}/install-airplay.sh" && bash "${airplay_script}"; then
    AIRPLAY_RESULT="installed"
  else
    # An optional capability must never fail the install. The player runs and
    # pairs either way; Studio reports AirPlay as not ready and names the
    # dependency that is missing.
    AIRPLAY_RESULT="failed"
  fi
  rm -f -- "${airplay_script}"
fi

# ------------------------------------------- Presentation Network helper

# Upgrading an existing player installs or repairs the root-owned helper without
# touching Ethernet or any other network configuration, and without installing
# NetworkManager on a box that does not already run it. When support is absent
# the sub-script says so and exits successfully, because the player is fully
# functional either way.
PRESENTATION_NETWORK_RESULT="skipped"
if [ "${WITH_PRESENTATION_NETWORK}" -eq 1 ]; then
  echo "Provisioning Presentation Network support (use --without-presentation-network to skip)..."
  network_script="$(mktemp /tmp/tilecast-presentation-network.XXXXXX.sh)"
  if curl -fsS -o "${network_script}" "${SERVER_URL}/install-presentation-network.sh" \
    && bash "${network_script}" --user "${KIOSK_USER}"; then
    PRESENTATION_NETWORK_RESULT="checked"
  else
    # An optional capability must never fail the install.
    PRESENTATION_NETWORK_RESULT="failed"
  fi
  rm -f -- "${network_script}"
fi

# ------------------------------------------------------------------ summary

echo
echo "Tilecast Player is installed."
echo "  Account:  ${KIOSK_USER}"
echo "  Player:   ${appimage}"
echo "  Server:   ${SERVER_URL}"
case "${AIRPLAY_RESULT}" in
  installed) echo "  AirPlay:  provisioned" ;;
  skipped) echo "  AirPlay:  skipped (--without-airplay)" ;;
  failed) echo "  AirPlay:  not provisioned; the player still runs. Re-run: curl -fsSL ${SERVER_URL}/install-airplay.sh | sudo bash" ;;
esac
case "${PRESENTATION_NETWORK_RESULT}" in
  checked) echo "  Networks: Presentation Network support checked (see the detail above)" ;;
  skipped) echo "  Networks: Presentation Network support skipped (--without-presentation-network)" ;;
  failed) echo "  Networks: Presentation Network helper not installed; the player still runs. Re-run: curl -fsSL ${SERVER_URL}/install-presentation-network.sh | sudo bash -s -- --user ${KIOSK_USER}" ;;
esac
if [ "${SERVICE_READY}" -eq 1 ]; then
  echo
  echo "Start it now with:  systemctl --user start tilecast-player"
else
  echo
  echo "The service starts with ${KIOSK_USER}'s next graphical session."
fi
echo "Then pair the screen from Studio: ${SERVER_URL}/screens"
