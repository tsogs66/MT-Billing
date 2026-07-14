#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / Pa-North
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# =============================================================================
#  Build SEPARATE flashable disk images for Raspberry Pi, Orange Pi, and PC.
# =============================================================================
#
# Dedicated wrappers (recommended):
#   sudo bash scripts/build-rpi-img.sh
#       → dist/flash/mt-billing-rpi-arm64.img
#       → dist/flash/mt-billing-rpi-arm64.img.xz
#
#   sudo bash scripts/build-opi-img.sh
#       → dist/flash/mt-billing-opi-arm64.img       (Orange Pi 5)
#       → dist/flash/mt-billing-opi-arm64.img.xz
#
#   sudo bash scripts/build-opi-one-img.sh
#       → dist/flash/mt-billing-opi-one-armhf.img   (Orange Pi One / H3)
#       → dist/flash/mt-billing-opi-one-armhf.img.xz
#
#   sudo bash scripts/build-pc-img.sh
#       → dist/flash/mt-billing-pc-amd64.img
#       → dist/flash/mt-billing-pc-amd64.img.xz
#
#   sudo bash scripts/build-all-flash-images.sh
#       → rpi + opi5 + opi-one + pc
#
# Or via this script:
#   sudo bash scripts/build-sbc-flash-image.sh --board rpi|opi|opi-one|pc|all
#
# Flash either the .img or .img.xz with Balena Etcher or Rufus (DD Image mode).
# After first boot (needs internet), open http://<device-ip>/
# Default panel login: admin / admin123
# Console SSH (all appliance images):
#   username: mtadmin
#   password: mtbilling
# Panel web login remains: admin / admin123
#
# IMPORTANT: Orange Pi boards are NOT interchangeable.
#   mt-billing-opi-arm64*     → Orange Pi 5 only
#   mt-billing-opi-one-armhf* → Orange Pi One only
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

# Default base images. Override with env if mirrors move.
# Raspberry Pi OS Lite 64-bit — works on Pi 3 / 4 / 5.
RPI_IMAGE_URL="${RPI_IMAGE_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-06-19/2026-06-18-raspios-trixie-arm64-lite.img.xz}"
# Orange Pi Armbian minimal images — resolved from GitHub releases unless overridden.
OPI_IMAGE_URL="${OPI_IMAGE_URL:-}"           # Orange Pi 5 (arm64)
OPI_ONE_IMAGE_URL="${OPI_ONE_IMAGE_URL:-}"   # Orange Pi One (armhf / H3)
# PC / x86_64 — Ubuntu 24.04 server cloud image (qcow2 .img → converted to raw).
PC_IMAGE_URL="${PC_IMAGE_URL:-https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img}"

# resolve_armbian_minimal <board-token> <override-url-env-value>
# board-token examples: orangepi5, orangepione
resolve_armbian_minimal() {
  local board_token="$1"
  local override_url="${2:-}"
  if [[ -n "$override_url" ]]; then
    printf '%s' "$override_url"
    return
  fi
  local url
  url="$(
    BOARD_TOKEN="$board_token" python3 -c '
import json, os, urllib.request
token = os.environ["BOARD_TOKEN"].lower()
raw = urllib.request.urlopen("https://api.github.com/repos/armbian/os/releases?per_page=10", timeout=60).read()
rels = json.loads(raw)
for r in rels:
  for a in r.get("assets") or []:
    n = a.get("name") or ""
    nl = n.lower()
    if token not in nl:
      continue
    # Avoid sibling boards (orangepi5-plus, orangepioneplus, etc.)
    if token == "orangepi5" and any(x in nl for x in ("plus", "max", "ultra", "pro")):
      continue
    if token == "orangepione" and any(x in nl for x in ("plus", "max", "ultra", "pro", "64")):
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
    echo "Could not auto-resolve Armbian ${board_token} minimal image. Set override URL env var." >&2
    exit 1
  fi
  printf '%s' "$url"
}

resolve_opi_image_url() {
  resolve_armbian_minimal "orangepi5" "${OPI_IMAGE_URL:-}"
}

resolve_opi_one_image_url() {
  resolve_armbian_minimal "orangepione" "${OPI_ONE_IMAGE_URL:-}"
}

usage() {
  awk 'NR==1{next} /^[^#]/{exit} {sub(/^# ?/,""); print}' "$0"
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
  opi5|orangepi5|opi-5) BOARD=opi ;;
  opi-one|opione|orangepione|orangepi-one|one) BOARD=opi-one ;;
  # Legacy alias: "opi" means Orange Pi 5 (arm64). Orange Pi One is opi-one.
  opi|orangepi|orange) BOARD=opi ;;
  pc|x86|x86_64|amd64|intel|desktop) BOARD=pc ;;
  all) ;;
  *) echo "Unsupported --board $BOARD (use rpi, opi, opi-one, pc, or all)" >&2; exit 1 ;;
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
need python3
need openssl
# mtools writes Raspberry Pi bootfs (FAT) even when the host kernel lacks vfat.
# Optional: growpart, e2fsck, resize2fs improve rootfs expansion when present.
# qemu-img is required when the PC base image is qcow2 (Ubuntu cloudimg).

mkdir -p "$OUT_DIR" "$CACHE_DIR"

download_image() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    echo "Using cached $(basename "$dest")"
    return
  fi
  echo "Downloading $url"
  # Armbian / cloud-image URLs often redirect — follow redirects.
  curl -fL --retry 3 --retry-delay 2 -o "$dest.partial" "$url"
  mv "$dest.partial" "$dest"
}

decompress_to_img() {
  local src="$1" dest="$2"
  local kind
  kind="$(file -b "$src" 2>/dev/null || true)"

  if [[ "$src" == *.xz ]] || echo "$kind" | grep -qi 'xz compressed'; then
    echo "Decompressing $(basename "$src")…"
    xz -T0 -dc "$src" >"$dest"
  elif echo "$kind" | grep -qi 'QEMU QCOW\|QCOW'; then
    need qemu-img
    echo "Converting qcow2 → raw $(basename "$dest")…"
    qemu-img convert -f qcow2 -O raw "$src" "$dest"
  elif [[ "$src" == *.img ]] || echo "$kind" | grep -qi 'boot sector\|DOS/MBR\|filesystem\|data'; then
    # Raw disk image (or already-extracted).
    if echo "$kind" | grep -qi 'QEMU QCOW\|QCOW'; then
      need qemu-img
      qemu-img convert -f qcow2 -O raw "$src" "$dest"
    else
      cp -f "$src" "$dest"
    fi
  else
    echo "Unrecognized image format: $src" >&2
    file "$src" >&2
    exit 1
  fi

  # After xz decompress, Ubuntu releases sometimes ship qcow2 inside .xz
  kind="$(file -b "$dest" 2>/dev/null || true)"
  if echo "$kind" | grep -qi 'QEMU QCOW\|QCOW'; then
    need qemu-img
    local tmp="${dest}.rawtmp"
    echo "Converting decompressed qcow2 → raw…"
    qemu-img convert -f qcow2 -O raw "$dest" "$tmp"
    mv -f "$tmp" "$dest"
  fi
}

inject_nocloud_seed() {
  local root_mnt="$1"
  # Ubuntu cloud images wait on a datasource; seed NoCloud so headless boot works
  # without a metadata service (USB/SSD appliance installs).
  install -d -m 0755 "$root_mnt/var/lib/cloud/seed/nocloud" \
    "$root_mnt/etc/cloud/cloud.cfg.d"

  cat >"$root_mnt/var/lib/cloud/seed/nocloud/meta-data" <<'EOF'
instance-id: mt-billing-pc
local-hostname: mt-billing
EOF

  cat >"$root_mnt/var/lib/cloud/seed/nocloud/user-data" <<'EOF'
#cloud-config
hostname: mt-billing
manage_etc_hosts: true
ssh_pwauth: true
users:
  - default
  - name: mtadmin
    gecos: MT-Billing admin
    groups: [sudo, adm]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
chpasswd:
  expire: false
  list: |
    mtadmin:mtbilling
package_update: false
runcmd:
  - [ sh, -c, "systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true" ]
EOF

  cat >"$root_mnt/etc/cloud/cloud.cfg.d/99-mt-billing.cfg" <<'EOF'
datasource_list: [ NoCloud, None ]
EOF
}

# Raspberry Pi OS: enable SSH + create console user via bootfs userconf.txt.
# Uses mtools so injection works even when the build host cannot mount vfat.
inject_rpi_boot_userconf() {
  local img="$1"
  local boot_off="$2"
  local boot_mnt="${3:-}"

  local hash confdir
  hash="$(openssl passwd -6 'mtbilling')"
  confdir="$(mktemp -d /tmp/mt-rpi-boot.XXXXXX)"
  : >"$confdir/ssh"
  printf 'mtadmin:%s\n' "$hash" >"$confdir/userconf.txt"

  if [[ -n "$boot_mnt" && -d "$boot_mnt" ]]; then
    install -m 0644 "$confdir/ssh" "$boot_mnt/ssh"
    install -m 0644 "$confdir/userconf.txt" "$boot_mnt/userconf.txt"
    echo "Wrote ssh + userconf.txt via mount (${boot_mnt})."
  elif command -v mcopy >/dev/null 2>&1; then
    export MTOOLS_SKIP_CHECK=1
    mcopy -o -i "${img}@@${boot_off}" "$confdir/ssh" ::ssh
    mcopy -o -i "${img}@@${boot_off}" "$confdir/userconf.txt" ::userconf.txt
    echo "Wrote ssh + userconf.txt via mtools (boot offset ${boot_off})."
  else
    echo "WARNING: could not write Raspberry Pi userconf (no vfat mount, no mtools)." >&2
    echo "Install mtools or dosfstools, or add userconf.txt on the SD boot partition manually." >&2
  fi
  rm -rf "$confdir"
}

inject_firstboot() {
  local img="$1"
  local board_name="$2"
  local loop="" boot_loop="" root_loop=""
  local boot_mnt root_mnt
  boot_mnt="$(mktemp -d /tmp/mt-boot.XXXXXX)"
  root_mnt="$(mktemp -d /tmp/mt-root.XXXXXX)"

  cleanup_mounts() {
    sync || true
    umount "$root_mnt/boot/firmware" 2>/dev/null || true
    umount "$root_mnt/boot/efi" 2>/dev/null || true
    umount "$root_mnt/boot" 2>/dev/null || true
    umount "$boot_mnt" 2>/dev/null || true
    umount "$root_mnt" 2>/dev/null || true
    [[ -n "${boot_loop:-}" ]] && losetup -d "$boot_loop" 2>/dev/null || true
    [[ -n "${root_loop:-}" ]] && losetup -d "$root_loop" 2>/dev/null || true
    [[ -n "${loop:-}" ]] && losetup -d "$loop" 2>/dev/null || true
    rmdir "$boot_mnt" "$root_mnt" 2>/dev/null || true
  }
  trap cleanup_mounts EXIT

  # Parse DOS/MBR or GPT partition table (works without kernel partition scan).
  local parts
  parts="$(
    python3 - "$img" <<'PY'
import struct, sys, uuid

path = sys.argv[1]
with open(path, "rb") as f:
    mbr = f.read(512)
    f.seek(512)
    sig = f.read(8)
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
        EFI = uuid.UUID("C12A7328-F81F-11D2-BA4B-00A0C93EC93B")
        MSB = uuid.UUID("EBD0A0A2-B9E5-4433-87C0-68B6B72699C7")
        BIOS = uuid.UUID("21686148-6449-6E6F-744E-656564454649")
        LINUX_FS = uuid.UUID("0FC63DAF-8483-4772-8E79-3D69D8477DE4")
        LINUX_ROOT = {
            uuid.UUID("4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709"),  # x86-64
            uuid.UUID("B921B045-1DF0-41C3-AF44-4C6F280D3FAE"),  # ARM64
            uuid.UUID("933AC7E1-2EB4-4F13-B844-0E14E2AEF915"),  # /home
            LINUX_FS,
        }
        f.seek(part_lba * 512)
        for i in range(part_count):
            e = f.read(part_entry_size)
            if len(e) < 56:
                break
            type_guid = uuid.UUID(bytes_le=e[0:16])
            if type_guid.int == 0:
                continue
            first_lba, last_lba = struct.unpack_from("<QQ", e, 32)
            off = first_lba * 512
            size = (last_lba - first_lba + 1) * 512
            if type_guid == BIOS:
                ptype = "bios"
            elif type_guid in (EFI, MSB):
                ptype = "ef"
            elif type_guid in LINUX_ROOT:
                ptype = "83"
            else:
                ptype = "other"
            print(f"{ptype} {off} {size}")
    else:
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
  local ptype off sz
  # Prefer largest Linux (83) partition as root; first FAT/EFI as boot.
  while read -r ptype off sz; do
    [[ -n "$ptype" ]] || continue
    case "$ptype" in
      0c|0b|0e|ef)
        if [[ -z "$boot_off" ]]; then boot_off="$off"; boot_sz="$sz"; fi
        ;;
      83|8e)
        if [[ -z "$root_off" ]] || [[ "${sz:-0}" -gt "${root_sz:-0}" ]]; then
          root_off="$off"
          root_sz="$sz"
        fi
        ;;
    esac
  done <<<"$parts"

  # Fallback: largest non-boot, non-bios partition.
  if [[ -z "$root_off" ]]; then
    while read -r ptype off sz; do
      case "$ptype" in
        0c|0b|0e|ef|bios) continue ;;
        *)
          if [[ -z "$root_off" ]] || [[ "${sz:-0}" -gt "${root_sz:-0}" ]]; then
            root_off="$off"
            root_sz="$sz"
          fi
          ;;
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

  mount "$root_loop" "$root_mnt"
  local boot_mounted=0
  if [[ -n "$boot_loop" ]]; then
    if [[ -d "$root_mnt/boot/firmware" ]] && mount -t vfat "$boot_loop" "$root_mnt/boot/firmware" 2>/dev/null; then
      boot_mnt="$root_mnt/boot/firmware"
      boot_mounted=1
    elif [[ -d "$root_mnt/boot/efi" ]] && mount -t vfat "$boot_loop" "$root_mnt/boot/efi" 2>/dev/null; then
      boot_mnt="$root_mnt/boot/efi"
      boot_mounted=1
    elif [[ -d "$root_mnt/boot" ]] && mount -t vfat "$boot_loop" "$root_mnt/boot" 2>/dev/null; then
      boot_mnt="$root_mnt/boot"
      boot_mounted=1
    elif mount -t vfat "$boot_loop" "$boot_mnt" 2>/dev/null; then
      boot_mounted=1
    else
      echo "Note: FAT/EFI boot partition not mountable here; enabling SSH via first-boot instead."
      boot_mnt=""
    fi
  else
    boot_mnt=""
  fi

  echo "Injecting first-boot installer (board=${board_name})…"
  install -d -m 0755 "$root_mnt/usr/local/lib/mt-billing" "$root_mnt/etc/systemd/system"
  install -m 0755 "$FIRSTBOOT" "$root_mnt/usr/local/lib/mt-billing/firstboot-mt-billing.sh"

  cat >"$root_mnt/etc/systemd/system/mt-billing-firstboot.service" <<'EOF'
[Unit]
Description=MT-Billing first-boot installer
After=network-online.target cloud-init.target
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

  mkdir -p "$root_mnt/etc/systemd/system/multi-user.target.wants"
  ln -sf /etc/systemd/system/mt-billing-firstboot.service \
    "$root_mnt/etc/systemd/system/multi-user.target.wants/mt-billing-firstboot.service"

  # Raspberry Pi: enable SSH + default console user (mtadmin / mtbilling)
  if [[ "$board_name" == "raspberry-pi" ]]; then
    if [[ -n "${boot_off:-}" ]]; then
      local rpi_boot_path=""
      if [[ "$boot_mounted" -eq 1 && -n "${boot_mnt:-}" && -d "$boot_mnt" ]]; then
        rpi_boot_path="$boot_mnt"
      fi
      inject_rpi_boot_userconf "$img" "$boot_off" "$rpi_boot_path"
    else
      echo "WARNING: no FAT boot partition found for Raspberry Pi userconf." >&2
    fi
  elif [[ "$boot_mounted" -eq 1 && -n "${boot_mnt:-}" && -d "$boot_mnt" ]]; then
    touch "$boot_mnt/ssh" 2>/dev/null || true
  fi

  # PC / Ubuntu cloud image: NoCloud seed so the appliance boots without metadata.
  if [[ "$board_name" == "pc" || "$board_name" == "pc-amd64" ]]; then
    inject_nocloud_seed "$root_mnt"
  fi

  cat >"$root_mnt/etc/mt-billing-image.json" <<EOF
{
  "product": "MT-Billing",
  "board": "${board_name}",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo": "https://github.com/tsogs66/MT-Billing",
  "default_login": "admin / admin123",
  "console_login": "mtadmin / mtbilling"
}
EOF

  sync
  cleanup_mounts
  trap - EXIT
  echo "First-boot injection complete."
}

build_one() {
  local kind="$1"
  local url cache_name out_base board_name
  case "$kind" in
    rpi)
      url="$RPI_IMAGE_URL"
      cache_name="rpi-base.img.xz"
      out_base="mt-billing-rpi-arm64"
      board_name="raspberry-pi"
      ;;
    opi)
      url="$(resolve_opi_image_url)"
      echo "Orange Pi 5 base image: $url"
      cache_name="opi5-base.img.xz"
      out_base="mt-billing-opi-arm64"
      board_name="orange-pi-5"
      ;;
    opi-one)
      url="$(resolve_opi_one_image_url)"
      echo "Orange Pi One base image: $url"
      cache_name="opi-one-base.img.xz"
      out_base="mt-billing-opi-one-armhf"
      board_name="orange-pi-one"
      ;;
    pc)
      url="$PC_IMAGE_URL"
      cache_name="pc-base.img"
      out_base="mt-billing-pc-amd64"
      board_name="pc-amd64"
      need qemu-img
      ;;
    *)
      echo "Unknown board kind: $kind" >&2
      exit 1
      ;;
  esac

  echo
  echo "======== Building $out_base ========"
  local cache="$CACHE_DIR/$cache_name"
  download_image "$url" "$cache"

  local raw="$OUT_DIR/${out_base}.img"
  rm -f "$raw" "$OUT_DIR/${out_base}.img.xz" "$OUT_DIR/${out_base}.img.sha256" "$OUT_DIR/${out_base}.img.xz.sha256"
  decompress_to_img "$cache" "$raw"
  inject_firstboot "$raw" "$board_name"

  local artifacts=("$raw")
  if [[ "$COMPRESS" -eq 1 ]]; then
    echo "Compressing with xz (this may take a few minutes)…"
    xz -T0 -f -k "$raw"
    artifacts+=("$raw.xz")
    if [[ "$KEEP_RAW" -eq 0 ]]; then
      rm -f "$raw"
      artifacts=("$raw.xz")
    fi
  fi

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
  echo "Flash the .img (or .img.xz) with Balena Etcher or Rufus (DD Image mode), then boot."
  echo "First boot installs MT-Billing automatically (needs internet)."
}

case "$BOARD" in
  all)
    build_one rpi
    build_one opi
    build_one opi-one
    build_one pc
    ;;
  *)
    build_one "$BOARD"
    ;;
esac

echo "Done. Images in: $OUT_DIR"
ls -lh "$OUT_DIR"/mt-billing-*.img* 2>/dev/null || true
