#!/usr/bin/env bash
set -eu

# Tilecast Presentation Network support for Debian-family Linux signage boxes.
#
# Installs the root-owned tilecast-networkd helper and its system service, and
# grants the kiosk account permission to talk to it — nothing more. The kiosk
# account never receives sudo, a polkit rule, or any standing NetworkManager
# privilege; it gets group membership on one unix socket that exposes five
# validated operations.
#
#   curl -fsSL https://your-server/install-presentation-network.sh | sudo bash -s -- --user tilecast
#
# Idempotent, like the player installer: re-running upgrades or repairs the
# helper in place and leaves the machine's existing network configuration alone.
#
# What this script will NOT do
# ----------------------------
# It will not install or enable NetworkManager. On a box running ifupdown,
# systemd-networkd, or a hand-rolled configuration, introducing NetworkManager
# can migrate or disrupt the working Ethernet setup that carries Tilecast itself.
# When NetworkManager is absent this script reports the limitation and exits
# successfully: the player still runs, AirPlay still works over Ethernet, and
# Studio reports Presentation Networks as unsupported on that player with the
# reason. It also never modifies the Ethernet connection.

readonly SERVER_URL="__TILECAST_SERVER_URL__"
readonly HELPER_DIR="/usr/local/lib/tilecast"
readonly HELPER_PATH="${HELPER_DIR}/tilecast-networkd"
readonly UNIT_PATH="/etc/systemd/system/tilecast-networkd.service"
readonly SOCKET_GROUP="tilecast-network"
readonly STATE_DIR="/var/lib/tilecast/presentation-networks"

KIOSK_USER=""

usage() {
  cat <<'USAGE'
Usage: install-presentation-network.sh [options]

  --user NAME   Kiosk account that runs Tilecast Player. Defaults to the account
                that invoked sudo, or "tilecast" when run as root directly.
  --help        Show this message.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user)
      [ "$#" -ge 2 ] || { echo "--user needs a value." >&2; exit 2; }
      KIOSK_USER="$2"
      shift 2
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
  echo "Run this provisioning script as root." >&2
  exit 1
fi

if [ -z "${KIOSK_USER}" ]; then
  KIOSK_USER="${SUDO_USER:-tilecast}"
fi
if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  echo "User ${KIOSK_USER} does not exist. Pass --user NAME." >&2
  exit 1
fi
if [ "${KIOSK_USER}" = "root" ]; then
  echo "The Tilecast Player runs as an unprivileged kiosk account, not root." >&2
  exit 1
fi

# ------------------------------------------------- detect support, never install

unsupported() {
  echo
  echo "Presentation Networks are NOT available on this machine."
  echo "  Reason: $1"
  echo
  echo "The Tilecast Player still runs normally, and AirPlay Present still works"
  echo "for senders that can already reach this player over Ethernet. Studio will"
  echo "report Presentation Networks as unsupported on this player with the reason"
  echo "above."
  exit 0
}

if ! command -v nmcli >/dev/null 2>&1; then
  # Deliberately not installed for you: adding NetworkManager to a box that uses
  # another networking stack can migrate or break the Ethernet configuration
  # Tilecast itself depends on. That is an operator's decision, not an
  # installer's.
  unsupported "NetworkManager (nmcli) is not installed. Tilecast will not install it, because doing so can migrate this machine's existing network configuration."
fi

if ! systemctl is-active --quiet NetworkManager.service; then
  unsupported "NetworkManager is installed but not running. Start it with: systemctl enable --now NetworkManager"
fi

if ! command -v python3 >/dev/null 2>&1; then
  # Unlike NetworkManager, a Python interpreter has nothing to do with the
  # machine's networking, so installing it cannot disturb the existing stack.
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing python3 for the Presentation Network helper..."
    DEBIAN_FRONTEND=noninteractive apt-get update >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3 >/dev/null 2>&1 || true
  fi
fi
if ! command -v python3 >/dev/null 2>&1; then
  unsupported "python3 is not available, and the Presentation Network helper needs it."
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

# ------------------------------------------------------------------ the helper

install -d -o root -g root -m 0755 "${HELPER_DIR}"
install -d -o root -g root -m 0700 "${STATE_DIR}"

download="$(mktemp /tmp/tilecast-networkd.XXXXXX)"
cleanup() { rm -f -- "${download}"; }
trap cleanup EXIT

echo "Downloading the Presentation Network helper from ${SERVER_URL}..."
curl -fsS -o "${download}" "${SERVER_URL}/api/v1/install/presentation-network/helper"
expected_sha="$(curl -fsS "${SERVER_URL}/api/v1/install/presentation-network/helper.sha256" | tr -d '[:space:]')"
actual_sha="$(sha256sum "${download}" | cut -d' ' -f1)"
if [ -z "${expected_sha}" ] || [ "${expected_sha}" != "${actual_sha}" ]; then
  echo "Presentation Network helper checksum mismatch: expected ${expected_sha:-none}, got ${actual_sha}." >&2
  exit 1
fi
if ! python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "${download}"; then
  echo "The downloaded Presentation Network helper is not valid Python." >&2
  exit 1
fi

# Root-owned and not writable by the kiosk account. This is the property the
# whole privilege boundary rests on: if the kiosk user could rewrite this file,
# the root service would execute kiosk-controlled code.
install -o root -g root -m 0755 "${download}" "${HELPER_PATH}"
rm -f -- "${download}"
trap - EXIT
echo "Installed ${HELPER_PATH} (root:root 0755)."

# ------------------------------------------------------------- socket group

if ! getent group "${SOCKET_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${SOCKET_GROUP}"
  echo "Created group ${SOCKET_GROUP}."
fi
if ! id -nG "${KIOSK_USER}" | tr ' ' '\n' | grep -qx "${SOCKET_GROUP}"; then
  usermod -a -G "${SOCKET_GROUP}" "${KIOSK_USER}"
  echo "Added ${KIOSK_USER} to ${SOCKET_GROUP}."
  GROUP_ADDED=1
else
  GROUP_ADDED=0
fi

# ----------------------------------------------------------------- the service

curl -fsS -o "${UNIT_PATH}.new" "${SERVER_URL}/install/tilecast-networkd.service"
install -o root -g root -m 0644 "${UNIT_PATH}.new" "${UNIT_PATH}"
rm -f -- "${UNIT_PATH}.new"

systemctl daemon-reload
systemctl enable tilecast-networkd.service >/dev/null 2>&1 || true
systemctl restart tilecast-networkd.service

# ------------------------------------------------------------------- verify

verified=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -S /run/tilecast/networkd.sock ]; then
    verified=1
    break
  fi
  sleep 1
done

if [ "${verified}" -ne 1 ]; then
  echo "Warning: the Presentation Network helper did not create its socket." >&2
  echo "Check: systemctl status tilecast-networkd" >&2
  exit 1
fi

# Ask the helper for its own status, as the kiosk account would, so a broken
# install is reported here rather than discovered during a presentation.
status_json="$(python3 - <<'PY' || true
import json, socket
try:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(20)
        connection.connect("/run/tilecast/networkd.sock")
        connection.sendall(json.dumps({"op": "status"}).encode() + b"\n")
        print(connection.recv(65536).decode().strip())
except Exception as error:  # noqa: BLE001
    print(json.dumps({"ok": False, "message": str(error)}))
PY
)"

echo
echo "Presentation Network support is installed."
echo "  Helper:   ${HELPER_PATH}"
echo "  Service:  tilecast-networkd.service"
echo "  Socket:   /run/tilecast/networkd.sock (root:${SOCKET_GROUP} 0660)"
echo "  Account:  ${KIOSK_USER} is a member of ${SOCKET_GROUP}"
echo "  Status:   ${status_json}"
if [ "${GROUP_ADDED}" -eq 1 ]; then
  echo
  echo "Restart the player so it picks up its new group membership:"
  echo "  systemctl --user -M ${KIOSK_USER}@ restart tilecast-player"
fi
echo
echo "Next: create a Presentation Network in Studio under Settings ->"
echo "Presentation Networks and assign it to this screen."
