#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / Pa-North
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# =============================================================================
#  SINGLE ENTRY POINT — build a flashable SD/USB image for Raspberry Pi or
#  Orange Pi. Flash the resulting .img.xz with Balena Etcher or Rufus.
# =============================================================================
#
# Usage (Linux build host, root required for losetup/mount):
#   sudo bash scripts/build-sbc-flash-image.sh --board rpi
#   sudo bash scripts/build-sbc-flash-image.sh --board opi
#   sudo bash scripts/build-sbc-flash-image.sh --board all
#
# Output:
#   dist/flash/mt-billing-rpi-arm64.img.xz
#   dist/flash/mt-billing-opi-arm64.img.xz
#
# Flash:
#   - Balena Etcher: open the .img.xz, select SD card, Flash
#   - Rufus (Windows): select the .img.xz (or extract .img), write in DD mode
#
# After first boot (5–20 min depending on network), open http://<device-ip>/
# Default login: admin / admin123
#
# System requirements: see SYSTEM_REQUIREMENTS.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/dist/flash}"
CACHE_DIR="${CACHE_DIR:-$ROOT/dist/flash-cache}"
FIRSTBOOT="$ROOT/flash/firstboot-mt-billing.sh"
BOARD="rpi"
COMPRESS=1
KEEP_RAW=0

# Default base images (arm64). Override with env if mirrors move.
# Raspberry Pi OS Lite 64-bit — works on Pi 3 / 4 / 5.
RPI_IMAGE_URL="${RPI_IMAGE_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-06-19/2026-06-18-raspios-trixie-arm64-lite.img.xz}"
# Orange Pi 5 Armbian minimal — resolved from GitHub releases unless overridden.
OPI_IMAGE_URL="${OPI_IMAGE_URL:-}"
# Auto-resolve latest Orangepi5 minimal .img.xz from armbian/os GitHub releases when unset.

resolve_opi_image_url() {
  if [[ -n "${OPI_IMAGE_URL:-}" ]]; then
    printf '%s' "$OPI_IMAGE_URL"
    return
  fi
  local url
  url="$(
    python3 -c '
import json, urllib.request
raw = urllib.request.urlopen("https://api.github.com/repos/armbian/os/releases?per_page=8", timeout=60).read()
rels = json.loads(raw)
for r in rels:
  for a in r.get("assets") or []:
    n = a.get("name") or ""
    nl = n.lower()
    if "orangepi5" not in nl:
      continue
    if any(x in nl for x in ("plus", "max", "ultra")):
      continue
    if not nl.endswith(".img.xz"):
      continue
    if "minimal" not in nl:
      continue
    print(a["browser_download_url"])
    raise SystemExit
' 2>/dev/null || true
  )"
  if [[ -z "$url" ]]; then
    echo "Could not auto-resolve Orange Pi 5 Armbian image. Set OPI_IMAGE_URL=https://..." >&2
    exit 1
  fi
  printf '%s' "$url"
}

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --board) BOARD="$2"; shift 2 ;;
    --board=*) BOARD="${1#*=}"; shift ;;
    --no-compress) COMPRESS=0; shift ;;
    --keep-raw) KEEP_RAW=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
done

BOARD="$(echo "$BOARD" | tr '[:upper:]' '[:lower:]')"
case "$BOARD" in
  rpi|raspberry|raspberrypi) BOARD=rpi ;;
  opi|orangepi|orange) BOARD=opi ;;
  all) ;;
  *) echo "Unsupported --board $BOARD (use rpi, opi, or all)" >&2; exit 1 ;;
esac

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (losetup/mount): sudo bash scripts/build-sbc-flash-image.sh --board $BOARD" >&2
  exit 1
fi

[[ -f "$FIRSTBOOT" ]] || { echo "Missing $FIRSTBOOT" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
need xz
need losetup
need mount
need umount
need sync
command -v sfdisk >/dev/null 2>&1 || need fdisk

mkdir -p "$OUT_DIR" "$CACHE_DIR"

download_image() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    echo "Using cached $(basename "$dest")"
    return
  fi
  echo "Downloading $url"
  # Armbian "minimal" URLs often redirect to a dated .img.xz — follow redirects.
  curl -fL --retry 3 --retry-delay 2 -o "$dest.partial" "$url"
  mv "$dest.partial" "$dest"
}

decompress_to_img() {
  local src="$1" dest="$2"
  if [[ "$src" == *.xz ]]; then
    echo "Decompressing $(basename "$src")…"
    xz -T0 -dc "$src" >"$dest"
  elif [[ "$src" == *.img ]]; then
    cp -f "$src" "$dest"
  else
    # Armbian download may already be .img.xz with a generic name
    if file "$src" | grep -qi 'xz compressed'; then
      xz -T0 -dc "$src" >"$dest"
    elif file "$src" | grep -qi 'boot sector\|DOS/MBR\|filesystem'; then
      cp -f "$src" "$dest"
    else
      echo "Unrecognized image format: $src" >&2
      file "$src" >&2
      exit 1
    fi
  fi
}

inject_firstboot() {
  local img="$1"
  local loop=""
  local boot_mnt root_mnt
  boot_mnt="$(mktemp -d /tmp/mt-boot.XXXXXX)"
  root_mnt="$(mktemp -d /tmp/mt-root.XXXXXX)"

  cleanup_mounts() {
    sync || true
    umount "$boot_mnt" 2>/dev/null || true
    umount "$root_mnt" 2>/dev/null || true
    [[ -n "$loop" ]] && losetup -d "$loop" 2>/dev/null || true
    rmdir "$boot_mnt" "$root_mnt" 2>/dev/null || true
  }
  trap cleanup_mounts EXIT

  # Grow image by 1 GiB so first-boot packages fit comfortably.
  dd if=/dev/zero bs=1M count=1024 status=none >>"$img"
  loop="$(losetup -fP --show "$img")"
  # Refresh partition table after size change (best-effort grow of last partition).
  if command -v growpart >/dev/null 2>&1; then
    growpart "$loop" 2 2>/dev/null || growpart "$loop" 1 2>/dev/null || true
  fi

  # Find boot (vfat) and root (ext4) partitions.
  local boot_dev="" root_dev=""
  local p
  for p in "${loop}p2" "${loop}p1" "${loop}p3"; do
    [[ -b "$p" ]] || continue
    local fstype
    fstype="$(blkid -o value -s TYPE "$p" 2>/dev/null || true)"
    if [[ "$fstype" == "vfat" && -z "$boot_dev" ]]; then
      boot_dev="$p"
    elif [[ "$fstype" == "ext4" && -z "$root_dev" ]]; then
      root_dev="$p"
    fi
  done
  # Single-partition images (some Armbian): treat p1 as root; boot may be /boot on root.
  if [[ -z "$root_dev" ]]; then
    for p in "${loop}p1" "${loop}p2"; do
      [[ -b "$p" ]] || continue
      root_dev="$p"
      break
    done
  fi
  [[ -n "$root_dev" ]] || { echo "Could not find root partition on $img" >&2; exit 1; }

  if command -v e2fsck >/dev/null 2>&1; then
    e2fsck -fy "$root_dev" >/dev/null 2>&1 || true
  fi
  if command -v resize2fs >/dev/null 2>&1; then
    resize2fs "$root_dev" >/dev/null 2>&1 || true
  fi

  mount "$root_dev" "$root_mnt"
  if [[ -n "$boot_dev" ]]; then
    mkdir -p "$root_mnt/boot" "$root_mnt/boot/firmware"
    mount "$boot_dev" "$boot_mnt"
    # Raspberry Pi OS Bookworm uses /boot/firmware; bind into root tree when possible.
    if [[ -d "$root_mnt/boot/firmware" ]]; then
      umount "$boot_mnt" 2>/dev/null || true
      mount "$boot_dev" "$root_mnt/boot/firmware"
      boot_mnt="$root_mnt/boot/firmware"
    else
      umount "$boot_mnt" 2>/dev/null || true
      mount "$boot_dev" "$root_mnt/boot"
      boot_mnt="$root_mnt/boot"
    fi
  fi

  echo "Injecting first-boot installer…"
  install -d -m 0755 "$root_mnt/usr/local/lib/mt-billing" "$root_mnt/etc/systemd/system"
  install -m 0755 "$FIRSTBOOT" "$root_mnt/usr/local/lib/mt-billing/firstboot-mt-billing.sh"

  cat >"$root_mnt/etc/systemd/system/mt-billing-firstboot.service" <<'EOF'
[Unit]
Description=MT-Billing first-boot installer
After=network-online.target
Wants=network-online.target
ConditionPathExists=/usr/local/lib/mt-billing/firstboot-mt-billing.sh

[Service]
Type=oneshot
ExecStart=/usr/local/lib/mt-billing/firstboot-mt-billing.sh
RemainAfterExit=yes
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

  # Enable without chroot when possible (symlink wants/)
  mkdir -p "$root_mnt/etc/systemd/system/multi-user.target.wants"
  ln -sf /etc/systemd/system/mt-billing-firstboot.service \
    "$root_mnt/etc/systemd/system/multi-user.target.wants/mt-billing-firstboot.service"

  # Raspberry Pi: enable SSH by default for headless setup
  if [[ -d "$boot_mnt" ]]; then
    touch "$boot_mnt/ssh" 2>/dev/null || true
    # userconf / cloud-init not required — firstboot installs the panel
  fi

  # Marker for support
  cat >"$root_mnt/etc/mt-billing-image.json" <<EOF
{
  "product": "MT-Billing",
  "board": "${BOARD_NAME}",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo": "https://github.com/tsogs66/MT-Billing",
  "default_login": "admin / admin123"
}
EOF

  sync
  cleanup_mounts
  trap - EXIT
  echo "First-boot injection complete."
}

build_one() {
  local kind="$1"
  local url cache_name out_base BOARD_NAME
  case "$kind" in
    rpi)
      url="$RPI_IMAGE_URL"
      cache_name="rpi-base.img.xz"
      out_base="mt-billing-rpi-arm64"
      BOARD_NAME="raspberry-pi"
      ;;
    opi)
      url="$(resolve_opi_image_url)"
      echo "Orange Pi base image: $url"
      cache_name="opi-base.img.xz"
      out_base="mt-billing-opi-arm64"
      BOARD_NAME="orange-pi"
      ;;
  esac

  echo
  echo "======== Building $out_base ========"
  local cache="$CACHE_DIR/$cache_name"
  download_image "$url" "$cache"

  local raw="$OUT_DIR/${out_base}.img"
  rm -f "$raw" "$OUT_DIR/${out_base}.img.xz"
  decompress_to_img "$cache" "$raw"
  inject_firstboot "$raw"

  local final="$raw"
  if [[ "$COMPRESS" -eq 1 ]]; then
    echo "Compressing with xz (this may take a few minutes)…"
    xz -T0 -f -k "$raw"
    final="$raw.xz"
    [[ "$KEEP_RAW" -eq 1 ]] || rm -f "$raw"
  fi

  # Checksums for GitHub releases
  (
    cd "$OUT_DIR"
    sha256sum "$(basename "$final")" >"$(basename "$final").sha256"
  )

  echo
  echo "Flashable image ready:"
  echo "  $final"
  echo "  $(du -h "$final" | awk '{print $1}')  sha256: $(awk '{print $1}' "$final.sha256")"
  echo
  echo "Flash with Balena Etcher or Rufus (DD mode), then boot the SBC."
  echo "First boot installs MT-Billing automatically (needs internet)."
}

case "$BOARD" in
  all)
    build_one rpi
    build_one opi
    ;;
  *)
    build_one "$BOARD"
    ;;
esac

echo "Done. Images in: $OUT_DIR"
