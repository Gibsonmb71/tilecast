#!/usr/bin/env bash
set -eu

# Provisioning-only script for Debian/Linux signage boxes. Run this as root
# while commissioning a machine; the Tilecast kiosk user never receives apt,
# sudo, or package-manager access. The player later starts UxPlay and GStreamer
# as that existing unprivileged user.

readonly UXPLAY_VERSION="1.73.6"
readonly UXPLAY_SHA256="3a1a754bc7ed4b0f72b6237aa4d769238b9c20a71b651bc3fe9ac679e2a67f18"
readonly SERVER_URL="__TILECAST_SERVER_URL__"

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
apt-get update
apt-get install -y \
  ca-certificates \
  cmake \
  coreutils \
  curl \
  tar \
  build-essential \
  pkg-config \
  libavahi-compat-libdnssd-dev \
  libgstreamer1.0-dev \
  libgstreamer-plugins-base1.0-dev \
  libgstreamer-plugins-bad1.0-dev \
  libplist-dev \
  libssl-dev \
  libx11-dev \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-libav \
  gstreamer1.0-vaapi \
  libva2 \
  i965-va-driver \
  vainfo \
  avahi-daemon \
  avahi-utils

uxplay_is_baseline() {
  command -v uxplay >/dev/null 2>&1 || return 1
  uxplay -v 2>&1 | grep -Eq "UxPlay[^0-9]*${UXPLAY_VERSION}([[:space:];]|$)"
}

if ! uxplay_is_baseline; then
  build_dir="$(mktemp -d /tmp/tilecast-uxplay.XXXXXX)"
  cleanup() {
    rm -rf -- "${build_dir}"
  }
  trap cleanup EXIT

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
