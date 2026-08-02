#!/usr/bin/env bash
set -eu

# Provisioning-only script for Debian/Linux signage boxes. Run this as root
# while commissioning a machine; the Tilecast kiosk user never receives apt,
# sudo, or package-manager access. The player later starts UxPlay and GStreamer
# as that existing unprivileged user.

readonly UXPLAY_VERSION="1.73.6"
readonly UXPLAY_REPOSITORY="https://github.com/FDH2/UxPlay.git"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this provisioning script as root." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian-family systems with apt-get." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  ca-certificates \
  cmake \
  git \
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

  git clone --depth 1 --branch "v${UXPLAY_VERSION}" "${UXPLAY_REPOSITORY}" "${build_dir}/UxPlay"
  cmake -S "${build_dir}/UxPlay" -B "${build_dir}/UxPlay/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "${build_dir}/UxPlay/build" --parallel "$(nproc)"
  cmake --install "${build_dir}/UxPlay/build"
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
