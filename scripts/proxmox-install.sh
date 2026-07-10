#!/usr/bin/env bash
# Wrapper — prefers local ct/mt-billing.sh; falls back to raw GitHub main.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../ct/mt-billing.sh" ]]; then
  exec bash "$SCRIPT_DIR/../ct/mt-billing.sh" "$@"
fi
exec bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/ct/mt-billing.sh)"
