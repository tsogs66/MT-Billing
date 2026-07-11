#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / Pa-North
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# =============================================================================
#  Build SEPARATE flashable disk images for Raspberry Pi and Orange Pi.
# =============================================================================
#
# Dedicated wrappers (recommended):
#   sudo bash scripts/build-rpi-img.sh
#       → dist/flash/mt-billing-rpi-arm64.img
#       → dist/flash/mt-billing-rpi-arm64.img.xz
#
#   sudo bash scripts/build-opi-img.sh
#       → dist/flash/mt-billing-opi-arm64.img
#       → dist/flash/mt-billing-opi-arm64.img.xz
#
# Or via this script:
#   sudo bash scripts/build-sbc-flash-image.sh --board rpi
#   sudo bash scripts/build-sbc-flash-image.sh --board opi
#   sudo bash scripts/build-sbc-flash-image.sh --board all
#
# Flash either the .img or .img.xz with Balena Etcher or Rufus (DD mode).
# After first boot (needs internet), open http://<device-ip>/
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
# Always keep the uncompressed .img as a separate flashable file per board.
KEEP_RAW=1

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
    --no-keep-raw) KEEP_RAW=0; shift ;;
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
need blkid
need file
# Optional: growpart, e2fsck, resize2fs improve rootfs expansion when present.

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
  local loop="" boot_loop="" root_loop=""
  local boot_mnt root_mnt
  boot_mnt="$(mktemp -d /tmp/mt-boot.XXXXXX)"
  root_mnt="$(mktemp -d /tmp/mt-root.XXXXXX)"

  cleanup_mounts() {
    sync || true
    umount "$root_mnt/boot/firmware" 2>/dev/null || true
    umount "$root_mnt/boot" 2>/dev/null || true
    umount "$boot_mnt" 2>/dev/null || true
    umount "$root_mnt" 2>/dev/null || true
    [[ -n "${boot_loop:-}" ]] && losetup -d "$boot_loop" 2>/dev/null || true
    [[ -n "${root_loop:-}" ]] && losetup -d "$root_loop" 2>/dev/null || true
    [[ -n "${loop:-}" ]] && losetup -d "$loop" 2>/dev/null || true
    rmdir "$boot_mnt" "$root_mnt" 2>/dev/null || true
  }
  trap cleanup_mounts EXIT

  # Do not pad the image here — partition growth needs growpart/kpartx which
  # are unavailable in many build containers. First-boot can expand on device.

  # Parse DOS/MBR or GPT partition table (works without kernel partition scan).
  local parts
  parts="$(
    python3 - "$img" <<'PY'
import struct, sys, uuid

path = sys.argv[1]
with open(path, "rb") as f:
    mbr = f.read(512)
    # GPT protective MBR?
    f.seek(512)
    sig = f.read(8)
    entries = []
    if sig == b"EFI PART":
        f.seek(512)
        hdr = f.read(92)
        (
            _sig,
            _rev,
            _hsize,
            _crc,
            _rsv,
            _current,
            _backup,
            _first_usable,
            _last_usable,
            _guid,
            part_lba,
            part_count,
            part_entry_size,
            _part_crc,
        ) = struct.unpack("<8sIIIIQQQQ16sQIII", hdr)
        f.seek(part_lba * 512)
        for i in range(part_count):
            e = f.read(part_entry_size)
            if len(e) < 56:
                break
            type_guid = e[0:16]
            if type_guid == b"\x00" * 16:
                continue
            first_lba, last_lba = struct.unpack_from("<QQ", e, 32)
            # EFI system = C12A7328-F81F-11D2-BA4B-00A0C93EC93B
            efi = uuid.UUID(bytes_le=type_guid) == uuid.UUID("C12A7328-F81F-11D2-BA4B-00A0C93EC93B")
            # Microsoft basic data often used for FAT boot on some images
            msb = uuid.UUID(bytes_le=type_guid) == uuid.UUID("EBD0A0A2-B9E5-4433-87C0-68B6B72699C7")
            linux = uuid.UUID(bytes_le=type_guid) == uuid.UUID("0FC63DAF-8483-4772-8E79-3D69D8477DE4")
            if efi or msb:
                ptype = "ef"
            elif linux:
                ptype = "83"
            else:
                ptype = "83"
            off = first_lba * 512
            size = (last_lba - first_lba + 1) * 512
            print(f"{ptype} {off} {size}")
    else:
        # DOS MBR
        for i in range(4):
            e = mbr[446 + i * 16 : 446 + (i + 1) * 16]
            _boot, _bh, _bs, _bc, ptype, _eh, _es, _ec, lba, sects = struct.unpack("<BBBBBBBBII", e)
            if ptype == 0 or sects == 0:
                continue
            print(f"{ptype:02x} {lba * 512} {sects * 512}")
PY
  )"
  [[ -n "$parts" ]] || { echo "Could not parse partition table on $img" >&2; exit 1; }

  local boot_off="" boot_sz="" root_off="" root_sz=""
  while read -r ptype off sz; do
    [[ -n "$ptype" ]] || continue
    case "$ptype" in
      0c|0b|0e|ef)
        if [[ -z "$boot_off" ]]; then boot_off="$off"; boot_sz="$sz"; fi
        ;;
      83|8e)
        if [[ -z "$root_off" ]]; then root_off="$off"; root_sz="$sz"; fi
        ;;
    esac
  done <<<"$parts"

  # Fallback: first non-FAT partition is root; first FAT is boot.
  if [[ -z "$root_off" ]]; then
    while read -r ptype off sz; do
      case "$ptype" in
        0c|0b|0e|ef) continue ;;
        *) root_off="$off"; root_sz="$sz"; break ;;
      esac
    done <<<"$parts"
  fi
  [[ -n "$root_off" ]] || { echo "Could not find root partition on $img" >&2; exit 1; }

  root_loop="$(losetup -f --show --offset "$root_off" ${root_sz:+--sizelimit "$root_sz"} "$img")"
  if [[ -n "$boot_off" ]]; then
    boot_loop="$(losetup -f --show --offset "$boot_off" ${boot_sz:+--sizelimit "$boot_sz"} "$img")"
  fi

  if command -v e2fsck >/dev/null 2>&1; then
    e2fsck -fy "$root_loop" >/dev/null 2>&1 || true
  fi
  if command -v resize2fs >/dev/null 2>&1; then
    # Root partition size in the table was not grown; skip resize unless growpart ran.
    true
  fi

  mount "$root_loop" "$root_mnt"
  local boot_mounted=0
  if [[ -n "$boot_loop" ]]; then
    if [[ -d "$root_mnt/boot/firmware" ]] && mount -t vfat "$boot_loop" "$root_mnt/boot/firmware" 2>/dev/null; then
      boot_mnt="$root_mnt/boot/firmware"
      boot_mounted=1
    elif [[ -d "$root_mnt/boot" ]] && mount -t vfat "$boot_loop" "$root_mnt/boot" 2>/dev/null; then
      boot_mnt="$root_mnt/boot"
      boot_mounted=1
    elif mount -t vfat "$boot_loop" "$boot_mnt" 2>/dev/null; then
      boot_mounted=1
    else
      echo "Note: FAT boot partition not mountable here; enabling SSH via first-boot instead."
      boot_mnt=""
    fi
  else
    boot_mnt=""
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

  # Raspberry Pi: enable SSH marker on boot partition when FAT is mountable
  if [[ "$boot_mounted" -eq 1 && -n "${boot_mnt:-}" && -d "$boot_mnt" ]]; then
    touch "$boot_mnt/ssh" 2>/dev/null || true
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
  local artifacts=("$raw")
  if [[ "$COMPRESS" -eq 1 ]]; then
    echo "Compressing with xz (this may take a few minutes)…"
    xz -T0 -f -k "$raw"
    artifacts+=("$raw.xz")
    final="$raw.xz"
    if [[ "$KEEP_RAW" -eq 0 ]]; then
      rm -f "$raw"
      artifacts=("$raw.xz")
    fi
  fi

  # Checksums for each produced artifact (separate .img per board)
  (
    cd "$OUT_DIR"
    for f in "${artifacts[@]}"; do
      base="$(basename "$f")"
      [[ -f "$base" ]] || continue
      sha256sum "$base" >"${base}.sha256"
    done
  )

  echo
  echo "======== $out_base ready ========"
  for f in "${artifacts[@]}"; do
    [[ -f "$f" ]] || continue
    echo "  $f"
    echo "    size: $(du -h "$f" | awk '{print $1}')  sha256: $(awk '{print $1}' "$f.sha256")"
  done
  echo
  echo "Flash the .img (or .img.xz) with Balena Etcher or Rufus (DD mode), then boot."
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
