#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / Pa-North
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# One-liner (run on Proxmox VE host as root):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/ct/mt-billing.sh)"
#
# Unattended default install:
#   mode=default bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/ct/mt-billing.sh)"

source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func | \
  sed 's|https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/install/|https://raw.githubusercontent.com/tsogs66/MT-Billing/main/install/|g')

APP="MT-Billing"
var_tags="${var_tags:-billing;network;mikrotik}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-4096}"
var_disk="${var_disk:-32}"
var_os="${var_os:-ubuntu}"
var_version="${var_version:-24}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"
var_nesting="${var_nesting:-0}"

export var_repo_url="${var_repo_url:-https://github.com/tsogs66/MT-Billing.git}"
export var_repo_branch="${var_repo_branch:-main}"
export var_install_dir="${var_install_dir:-/opt/mt-billing}"
export var_admin_user="${var_admin_user:-admin}"
export var_admin_pass="${var_admin_pass:-admin123}"
export var_api_port="${var_api_port:-4000}"
export var_panel_port="${var_panel_port:-80}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -f /etc/systemd/system/mt-billing-api.service ]]; then
    msg_error "No ${APP} installation found!"
    exit 1
  fi

  msg_info "Stopping MT-Billing API"
  systemctl stop mt-billing-api
  msg_ok "Stopped MT-Billing API"

  NODE_VERSION="22" setup_nodejs

  local dir="${var_install_dir:-/opt/mt-billing}"
  local branch="${var_repo_branch:-main}"
  msg_info "Updating application from ${var_repo_url:-https://github.com/tsogs66/MT-Billing.git} (${branch})"
  if [[ -d "$dir/.git" ]]; then
    git -C "$dir" fetch origin
    git -C "$dir" checkout "$branch"
  $STD git -C "$dir" pull --ff-only origin "$branch" || true
  else
    $STD git clone --branch "$branch" --depth 1 "${var_repo_url:-https://github.com/tsogs66/MT-Billing.git}" "$dir"
  fi

  local svc_user
  svc_user="$(grep '^User=' /etc/systemd/system/mt-billing-api.service | cut -d= -f2)"
  svc_user="${svc_user:-mtbilling}"

  msg_info "Building application"
  $STD sudo -u "$svc_user" bash -c "cd '$dir' && npm install && npm run build && npm --prefix server run build"
  msg_ok "Built application"

  msg_info "Starting services"
  systemctl start mt-billing-api
  systemctl reload nginx 2>/dev/null || true
  msg_ok "Started services"
  msg_ok "Updated successfully!"
  exit
}

description() {
  IP=$(pct exec "$CTID" ip a s dev eth0 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -1)
  DESCRIPTION=$(
    cat <<EOF
<div align='center'>
  <a href='https://github.com/tsogs66/MT-Billing' target='_blank'>
    <img src='https://img.shields.io/badge/GitHub-MT--Billing-blue?style=for-the-badge&logo=github&logoColor=white' alt='GitHub'/>
  </a>
</div>
<div align='center'>${APP} — MikroTik billing &amp; PPPoE/IPoE panel (Pa-North)</div>
EOF
  )
  pct set "$CTID" -description "$DESCRIPTION" >/dev/null 2>&1 || true

  if [[ -f /etc/systemd/system/ping-instances.service ]]; then
    systemctl start ping-instances.service 2>/dev/null || true
  fi

  msg_ok "Completed successfully!\n"
  echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
  echo -e "${INFO}${YW}Access the panel:${CL}"
  echo -e "${TAB}${GATEWAY}${BGN}http://${IP:-<container-ip>}${CL}"
  echo -e "${INFO}${YW}Default login: ${var_admin_user:-admin} / ${var_admin_pass:-admin123} — change immediately${CL}"
  echo -e "${INFO}${YW}Service: systemctl status mt-billing-api${CL}"
}

start
build_container
description
