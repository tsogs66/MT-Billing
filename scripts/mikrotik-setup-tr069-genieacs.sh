#!/usr/bin/env bash
# Run TR-069 MikroTik setup from repo root (billing LXC). Not for RouterOS terminal.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d server/node_modules/node-routeros ]]; then
  echo "Installing server dependencies…"
  npm install
fi
exec node "$ROOT/scripts/mikrotik-setup-tr069-genieacs.mjs" "$@"
