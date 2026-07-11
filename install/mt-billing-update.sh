#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / ts0gs
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# Guest update script — run inside the MT-Billing LXC/VM (or via Proxmox pct exec).
# Pulls the configured branch from GitHub, rebuilds, and restarts services.
#
# Usage:
#   sudo bash /opt/mt-billing/install/mt-billing-update.sh
#   MT_BILLING_AUTO_ONLY=1 bash install/mt-billing-update.sh   # skip if already up to date
#   bash install/mt-billing-update.sh --check                  # exit 0 if update available
#
# Environment:
#   var_install_dir / INSTALL_DIR   default /opt/mt-billing
#   var_repo_url    / REPO_URL      default https://github.com/tsogs66/MT-Billing.git
#   var_repo_branch / REPO_BRANCH   default main
#   MT_BILLING_AUTO_ONLY=1          only apply when origin is ahead of HEAD
#   MT_BILLING_SKIP_BUILD=1         pull only (not recommended)

set -euo pipefail

INSTALL_DIR="${var_install_dir:-${INSTALL_DIR:-/opt/mt-billing}}"
REPO_URL="${var_repo_url:-${REPO_URL:-https://github.com/tsogs66/MT-Billing.git}}"
REPO_BRANCH="${var_repo_branch:-${REPO_BRANCH:-main}}"
AUTO_ONLY="${MT_BILLING_AUTO_ONLY:-0}"
SKIP_BUILD="${MT_BILLING_SKIP_BUILD:-0}"
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --auto) AUTO_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# community-scripts / Proxmox helper logging (optional)
if [[ -n "${FUNCTIONS_FILE_PATH:-}" && -f "${FUNCTIONS_FILE_PATH}" ]]; then
  # shellcheck disable=SC1090
  source "$FUNCTIONS_FILE_PATH"
  color 2>/dev/null || true
elif ! declare -F msg_info &>/dev/null; then
  msg_info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
  msg_ok() { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
  msg_error() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }
  STD=""
fi

log_info() { if declare -F msg_info &>/dev/null; then msg_info "$@"; else echo "[INFO] $*"; fi; }
log_ok() { if declare -F msg_ok &>/dev/null; then msg_ok "$@"; else echo "[OK] $*"; fi; }
log_err() { if declare -F msg_error &>/dev/null; then msg_error "$@"; else echo "[ERROR] $*" >&2; fi; }
run() { if [[ -n "${STD:-}" ]]; then $STD "$@"; else "$@"; fi; }

SERVICE_UNIT="/etc/systemd/system/mt-billing-api.service"
STATE_DIR="${INSTALL_DIR}/server/data"
STATE_FILE="${STATE_DIR}/.last-update.json"

service_user() {
  if [[ -f "$SERVICE_UNIT" ]]; then
    grep '^User=' "$SERVICE_UNIT" | cut -d= -f2
  else
    echo "${var_service_user:-mtbilling}"
  fi
}

remote_sha() {
  git -C "$INSTALL_DIR" fetch -q origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" rev-parse "origin/${REPO_BRANCH}"
}

local_sha() {
  git -C "$INSTALL_DIR" rev-parse HEAD
}

write_state() {
  local status="$1"
  local from="$2"
  local to="$3"
  mkdir -p "$STATE_DIR"
  cat >"$STATE_FILE" <<EOF
{"status":"${status}","branch":"${REPO_BRANCH}","from":"${from}","to":"${to}","at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
}

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  log_err "No git checkout at ${INSTALL_DIR}"
  exit 1
fi

if [[ ! -f "$SERVICE_UNIT" ]]; then
  log_err "mt-billing-api.service not found — is MT-Billing installed?"
  exit 1
fi

SVC_USER="$(service_user)"
SVC_USER="${SVC_USER:-mtbilling}"

log_info "Checking ${REPO_URL} (${REPO_BRANCH})"
BEFORE="$(local_sha)"
REMOTE="$(remote_sha)"

if [[ "$BEFORE" == "$REMOTE" ]]; then
  log_ok "Already up to date (${BEFORE:0:12})"
  write_state "current" "$BEFORE" "$REMOTE"
  if [[ "$CHECK_ONLY" == "1" ]]; then
    exit 1
  fi
  exit 0
fi

if [[ "$CHECK_ONLY" == "1" ]]; then
  log_info "Update available: ${BEFORE:0:12} → ${REMOTE:0:12}"
  exit 0
fi

if [[ "$AUTO_ONLY" == "1" ]]; then
  log_info "New commits on origin — applying update ${BEFORE:0:12} → ${REMOTE:0:12}"
fi

log_info "Stopping MT-Billing API"
run systemctl stop mt-billing-api
log_ok "Stopped MT-Billing API"

if declare -F setup_nodejs &>/dev/null; then
  NODE_VERSION="22" setup_nodejs
fi

log_info "Pulling latest code"
run git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
run git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"
AFTER="$(local_sha)"
log_ok "Checked out ${AFTER:0:12}"

if [[ "$SKIP_BUILD" != "1" ]]; then
  log_info "Installing dependencies and building"
  run chown -R "${SVC_USER}:${SVC_USER}" "$INSTALL_DIR"
  run sudo -u "$SVC_USER" bash -c "cd '$INSTALL_DIR' && npm install && npm run build && npm --prefix server run build"
  log_ok "Build complete"
fi

log_info "Starting services"
run systemctl start mt-billing-api
run systemctl reload nginx 2>/dev/null || true
log_ok "Services started"

write_state "updated" "$BEFORE" "$AFTER"
log_ok "Update complete (${BEFORE:0:12} → ${AFTER:0:12})"
