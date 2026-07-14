#!/usr/bin/env bash
# Build all flashable appliance images (Raspberry Pi, Orange Pi, PC).
# Output under dist/flash/:
#   mt-billing-rpi-arm64.img(.xz)
#   mt-billing-opi-arm64.img(.xz)
#   mt-billing-pc-amd64.img(.xz)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT/scripts/build-sbc-flash-image.sh" --board all "$@"
