#!/usr/bin/env bash
set -eu

# Provisioning-only script for Debian/Linux signage boxes. Run this as root
# while commissioning a machine; the Tilecast kiosk user never receives apt,
# sudo, or package-manager access. The player later starts UxPlay and GStreamer
# as that existing unprivileged user.
#
# Footprint policy
# ----------------
# The target is 2012-era Celeron-class signage hardware with ~4 GB RAM and a
# small disk. Runtime dependencies are installed permanently. The UxPlay build
# toolchain (a compiler, cmake, and eight -dev packages, roughly 800 MB with
# its transitive closure on Debian Trixie) is installed only when UxPlay
# actually has to be built, and is removed again afterwards.
#
# Only packages this script installed are removed. The set is computed by
# diffing dpkg's installed list around the toolchain install, so a machine that
# already had build-essential — a developer box, or a second Tilecast component
# that needs it — keeps it. Packages the built uxplay binary links against are
# resolved from the binary itself and protected, and the cleanup is simulated
# first: if apt would take a protected package with it, cleanup is skipped
# rather than risking a working install.

readonly UXPLAY_VERSION="1.73.6"
readonly UXPLAY_SHA256="3a1a754bc7ed4b0f72b6237aa4d769238b9c20a71b651bc3fe9ac679e2a67f18"
readonly SERVER_URL="__TILECAST_SERVER_URL__"
readonly UXPLAY_BIN="/usr/local/bin/uxplay"
readonly STATE_DIR="/var/lib/tilecast"
readonly BUILD_PACKAGE_STATE="${STATE_DIR}/airplay-build-packages"

# Everything UxPlay and the Tilecast RTP receivers need at run time. These stay
# installed.
readonly RUNTIME_PACKAGES="
  ca-certificates
  coreutils
  curl
  tar
  gstreamer1.0-tools
  gstreamer1.0-plugins-base
  gstreamer1.0-plugins-good
  gstreamer1.0-plugins-bad
  gstreamer1.0-libav
  gstreamer1.0-vaapi
  libva2
  i965-va-driver
  vainfo
  avahi-daemon
  avahi-utils
"

# Only needed to compile UxPlay from the pinned source archive. UxPlay's CMake
# requires gstreamer-1.0, -sdp, -video, and -app (libgstreamer1.0-dev plus
# plugins-base1.0-dev), libplist-2.0, OpenSSL, avahi-compat-libdns_sd, and
# optionally X11. plugins-bad supplies runtime decoders, not build headers.
readonly BUILD_PACKAGES="
  build-essential
  cmake
  pkg-config
  libavahi-compat-libdnssd-dev
  libgstreamer1.0-dev
  libgstreamer-plugins-base1.0-dev
  libplist-dev
  libssl-dev
  libx11-dev
"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this provisioning script as root." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian-family systems with apt-get." >&2
  exit 1
fi

if [ "$(uname -m)" != "x86_64" ]; then
  echo "Tilecast AirPlay provisioning currently supports x86_64 Linux; this machine is $(uname -m)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

installed_packages() {
  dpkg-query -W -f='${binary:Package}\n' 2>/dev/null | sed 's/:.*//' | sort -u
}

uxplay_is_baseline() {
  command -v uxplay >/dev/null 2>&1 || return 1
  uxplay -v 2>&1 | grep -Eq "UxPlay[^0-9]*${UXPLAY_VERSION}([[:space:];]|$)"
}

# shellcheck disable=SC2086
apt-get update
# shellcheck disable=SC2086
apt-get install -y ${RUNTIME_PACKAGES}

mkdir -p "${STATE_DIR}"

# Re-running on a provisioned machine installs no toolchain at all: the pinned
# UxPlay is already present and verified, so the whole build block is skipped.
if uxplay_is_baseline; then
  echo "UxPlay ${UXPLAY_VERSION} is already installed; skipping the build toolchain."
else
  before_packages="$(mktemp /tmp/tilecast-pkgs-before.XXXXXX)"
  after_packages="$(mktemp /tmp/tilecast-pkgs-after.XXXXXX)"
  build_dir="$(mktemp -d /tmp/tilecast-uxplay.XXXXXX)"
  cleanup() {
    rm -rf -- "${build_dir}" "${before_packages}" "${after_packages}"
  }
  trap cleanup EXIT

  installed_packages > "${before_packages}"
  echo "Installing the UxPlay build toolchain (removed again after the build)..."
  # shellcheck disable=SC2086
  apt-get install -y ${BUILD_PACKAGES}
  installed_packages > "${after_packages}"
  # Everything apt added for the toolchain, direct and transitive. Packages that
  # were already on the machine are never in this list and are never touched.
  #
  # Merged with any state a previous run recorded, never overwritten. A run that
  # installs the toolchain and then fails (no route to the archive, a build
  # error) leaves it on disk; on the retry those packages are already present,
  # so this diff is empty. Truncating here would forget them and leak the whole
  # toolchain permanently.
  comm -13 "${before_packages}" "${after_packages}" >> "${BUILD_PACKAGE_STATE}"
  sort -u -o "${BUILD_PACKAGE_STATE}" "${BUILD_PACKAGE_STATE}"
  chmod 600 "${BUILD_PACKAGE_STATE}"

  archive="${build_dir}/uxplay-${UXPLAY_VERSION}.tar.gz"
  advertised_sha="$(curl -fsS "${SERVER_URL}/api/v1/install/airplay/uxplay.sha256")"
  if [ "${advertised_sha}" != "${UXPLAY_SHA256}" ]; then
    echo "Tilecast published an unexpected UxPlay ${UXPLAY_VERSION} checksum." >&2
    exit 1
  fi

  curl -fSL --progress-bar -o "${archive}" "${SERVER_URL}/api/v1/install/airplay/uxplay"
  actual_sha="$(sha256sum "${archive}" | cut -d' ' -f1)"
  if [ "${actual_sha}" != "${UXPLAY_SHA256}" ]; then
    echo "UxPlay ${UXPLAY_VERSION} checksum mismatch: expected ${UXPLAY_SHA256}, got ${actual_sha}." >&2
    exit 1
  fi

  tar -xzf "${archive}" -C "${build_dir}"
  source_dir="${build_dir}/UxPlay-${UXPLAY_VERSION}"
  cmake -S "${source_dir}" -B "${source_dir}/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "${source_dir}/build" --parallel "$(nproc)"
  cmake --install "${source_dir}/build"
  # A distro UxPlay may already have been resolved from /usr/bin. Forget that
  # shell cache so verification sees the newly installed /usr/local/bin copy.
  hash -r
fi

if ! uxplay_is_baseline; then
  echo "UxPlay ${UXPLAY_VERSION} is required, but the installed version could not be verified." >&2
  exit 1
fi

# ------------------------------------------------- reclaim the build toolchain

remove_build_toolchain() {
  [ -s "${BUILD_PACKAGE_STATE}" ] || return 0
  local candidates protected removable simulated
  candidates="$(tr '\n' ' ' < "${BUILD_PACKAGE_STATE}")"
  [ -n "${candidates// /}" ] || return 0

  # Anything the built binary actually links against stays, whatever its package
  # is called on this release. Guessing runtime package names across Debian
  # releases is how a "cleanup" turns into an unusable uxplay.
  protected="$(
    ldd "${UXPLAY_BIN}" 2>/dev/null |
      awk '{ for (i = 1; i <= NF; i++) if (substr($i, 1, 1) == "/") { print $i; break } }' |
      xargs -r dpkg -S 2>/dev/null | cut -d: -f1 | tr ',' '\n' | tr -d ' ' | sort -u
  )"

  removable=""
  local package
  for package in ${candidates}; do
    if [ -n "${protected}" ] && printf '%s\n' "${protected}" | grep -qx -- "${package}"; then
      continue
    fi
    removable="${removable} ${package}"
  done
  [ -n "${removable// /}" ] || return 0

  # Simulate first. If apt would cascade into a package uxplay links against,
  # leave the toolchain in place: disk space is cheaper than a broken receiver.
  # shellcheck disable=SC2086
  if ! simulated="$(apt-get -s purge -y ${removable} 2>/dev/null)"; then
    echo "Warning: could not plan build-toolchain removal; leaving it installed." >&2
    return 0
  fi
  local doomed
  doomed="$(printf '%s\n' "${simulated}" | awk '$1 == "Purg" || $1 == "Remv" { print $2 }' | sort -u)"
  if [ -n "${protected}" ] && [ -n "$(comm -12 <(printf '%s\n' "${protected}") <(printf '%s\n' "${doomed}"))" ]; then
    echo "Warning: removing the build toolchain would also remove a UxPlay runtime library; leaving it installed." >&2
    return 0
  fi

  echo "Removing the UxPlay build toolchain Tilecast installed..."
  # shellcheck disable=SC2086
  if ! apt-get purge -y ${removable} >/dev/null; then
    echo "Warning: the build toolchain could not be removed; it is safe to remove manually." >&2
    return 0
  fi
  hash -r
  if ! uxplay_is_baseline; then
    echo "UxPlay stopped working after toolchain removal; restoring the packages." >&2
    # shellcheck disable=SC2086
    apt-get install -y ${removable} >/dev/null || true
    hash -r
    return 0
  fi
  : > "${BUILD_PACKAGE_STATE}"
  echo "Build toolchain removed; UxPlay ${UXPLAY_VERSION} verified."
}

remove_build_toolchain

# Avahi advertises only the services a session asks UxPlay to publish. Keep the
# daemon available for Bonjour discovery, but do not create a permanent
# AirPlay service or a kiosk-user systemd unit here.
systemctl enable --now avahi-daemon.service

command -v gst-launch-1.0 >/dev/null
command -v gst-inspect-1.0 >/dev/null
command -v vainfo >/dev/null
command -v avahi-browse >/dev/null
gst-inspect-1.0 rtph264depay >/dev/null
gst-inspect-1.0 h264parse >/dev/null
gst-inspect-1.0 avdec_h264 >/dev/null
gst-inspect-1.0 fpsdisplaysink >/dev/null

if gst-inspect-1.0 vah264dec >/dev/null 2>&1; then
  echo "VA-API decoder available: vah264dec"
elif gst-inspect-1.0 vaapih264dec >/dev/null 2>&1; then
  echo "VA-API decoder available: vaapih264dec"
else
  echo "Warning: no VA-API H.264 decoder is registered; Tilecast will limit AirPlay to 720p30 software decode." >&2
fi

echo "AirPlay support provisioned: UxPlay ${UXPLAY_VERSION}, GStreamer H.264, VA-API probe, and Avahi."
