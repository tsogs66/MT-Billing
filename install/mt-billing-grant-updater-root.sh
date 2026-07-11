#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / ts0gs
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# Grant the Application Updater root privilege so "Update from GitHub" works
# from the panel UI (API runs as the mtbilling service user).
#
# Run once on the LXC/VM as root:
#   curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/install/mt-billing-grant-updater-root.sh | sudo bash
#
# Or locally:
#   sudo bash /opt/mt-billing/install/mt-billing-grant-updater-root.sh
#
# Then optionally pull latest:
#   sudo bash /opt/mt-billing/install/mt-billing-update.sh

set -euo pipefail

INSTALL_DIR="${var_install_dir:-${INSTALL_DIR:-/opt/mt-billing}}"
REPO_BRANCH="${var_repo_branch:-${REPO_BRANCH:-main}}"
SERVICE_UNIT="/etc/systemd/system/mt-billing-api.service"
PANEL_UPDATE_UNIT="/etc/systemd/system/mt-billing-panel-update.service"
SUDOERS_FILE="/etc/sudoers.d/mt-billing"
UPDATE_SCRIPT="${INSTALL_DIR}/install/mt-billing-update.sh"

log_info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
log_ok() { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
log_err() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }

if [[ "$(id -u)" -ne 0 ]]; then
  log_err "Run as root: sudo bash $0"
  exit 1
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  log_err "Install dir not found: $INSTALL_DIR"
  exit 1
fi

svc_user="mtbilling"
if [[ -f "$SERVICE_UNIT" ]]; then
  detected="$(grep '^User=' "$SERVICE_UNIT" | cut -d= -f2 || true)"
  [[ -n "$detected" ]] && svc_user="$detected"
fi
svc_user="${var_service_user:-${SERVICE_USER:-$svc_user}}"

log_info "Granting updater root privilege to service user: ${svc_user}"

# Ensure update script exists (fetch from GitHub if missing)
if [[ ! -f "$UPDATE_SCRIPT" ]]; then
  log_info "Fetching mt-billing-update.sh from GitHub"
  mkdir -p "$(dirname "$UPDATE_SCRIPT")"
  curl -fsSL "https://raw.githubusercontent.com/tsogs66/MT-Billing/${REPO_BRANCH}/install/mt-billing-update.sh" \
    -o "$UPDATE_SCRIPT"
fi
chmod 755 "$UPDATE_SCRIPT"

# Panel-triggered oneshot (runs update as root under systemd)
cat >"$PANEL_UPDATE_UNIT" <<EOF
[Unit]
Description=MT-Billing panel update (triggered from Application Updater UI)
Documentation=https://github.com/tsogs66/MT-Billing
After=network-online.target

[Service]
Type=oneshot
Nice=5
Environment=var_install_dir=${INSTALL_DIR}
Environment=var_repo_branch=${REPO_BRANCH}
Environment=INSTALL_DIR=${INSTALL_DIR}
Environment=REPO_BRANCH=${REPO_BRANCH}
Environment=MT_BILLING_AUTO_ONLY=0
ExecStart=/bin/bash ${UPDATE_SCRIPT}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Passwordless sudo for the API service user — start oneshot OR run update script
cat >"$SUDOERS_FILE" <<EOF
# MT-Billing — Application Updater root privilege
# Managed by install/mt-billing-grant-updater-root.sh — do not edit by hand
Defaults:${svc_user} !requiretty
${svc_user} ALL=(root) NOPASSWD: /bin/systemctl start mt-billing-panel-update.service
${svc_user} ALL=(root) NOPASSWD: /bin/systemctl start --no-block mt-billing-panel-update.service
${svc_user} ALL=(root) NOPASSWD: /usr/bin/systemctl start mt-billing-panel-update.service
${svc_user} ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block mt-billing-panel-update.service
${svc_user} ALL=(root) NOPASSWD: /bin/bash ${UPDATE_SCRIPT}
${svc_user} ALL=(root) NOPASSWD: /usr/bin/bash ${UPDATE_SCRIPT}
EOF
chmod 440 "$SUDOERS_FILE"

if command -v visudo >/dev/null 2>&1; then
  if ! visudo -cf "$SUDOERS_FILE" >/dev/null 2>&1; then
    log_err "sudoers validation failed — removing $SUDOERS_FILE"
    rm -f "$SUDOERS_FILE"
    exit 1
  fi
fi

systemctl daemon-reload
log_ok "Installed ${PANEL_UPDATE_UNIT}"
log_ok "Installed ${SUDOERS_FILE} for ${svc_user}"

# Verify passwordless sudo works as the service user
if id "$svc_user" >/dev/null 2>&1; then
  if sudo -u "$svc_user" sudo -n true 2>/dev/null; then
    log_ok "Verified: ${svc_user} can use passwordless sudo"
  else
    # sudo -n true may fail if no blanket rule — check specific command
    if sudo -u "$svc_user" sudo -n systemctl start --no-block mt-billing-panel-update.service --dry-run 2>/dev/null \
      || sudo -u "$svc_user" sudo -n -l 2>/dev/null | grep -q mt-billing-panel-update; then
      log_ok "Verified: ${svc_user} may start mt-billing-panel-update.service"
    else
      log_info "sudoers installed (check with: sudo -u ${svc_user} sudo -n -l)"
    fi
  fi
fi

# Clear stuck "running" job marker so UI can retry
STATE_FILE="${INSTALL_DIR}/server/data/.last-update.json"
if [[ -f "$STATE_FILE" ]]; then
  if grep -q '"status":"running"' "$STATE_FILE" 2>/dev/null; then
    printf '{"status":"failed","branch":"%s","from":null,"to":null,"at":"%s","message":"Cleared after granting updater root privilege. Try Update from GitHub again."}\n' \
      "$REPO_BRANCH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STATE_FILE"
    log_ok "Cleared stuck updater job state"
  fi
fi

echo
log_ok "Updater root privilege granted"
echo "  Service user : ${svc_user}"
echo "  Oneshot unit : mt-billing-panel-update.service"
echo "  Sudoers      : ${SUDOERS_FILE}"
echo
echo "Next:"
echo "  1) Refresh the Application Updater page"
echo "  2) Click Update from GitHub"
echo "  Or pull now: sudo bash ${UPDATE_SCRIPT}"
echo
