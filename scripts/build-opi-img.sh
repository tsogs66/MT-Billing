#!/usr/bin/env bash
# Build the Orange Pi flash image only.
# Output:
#   dist/flash/mt-billing-opi-arm64.img
#   dist/flash/mt-billing-opi-arm64.img.xz
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT/scripts/build-sbc-flash-image.sh" --board opi "$@"
