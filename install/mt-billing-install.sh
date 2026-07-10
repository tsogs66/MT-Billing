#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / Pa-North
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# Guest install script — executed inside the LXC by community-scripts build.func

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

INSTALL_DIR="${var_install_dir:-/opt/mt-billing}"
REPO_URL="${var_repo_url:-https://github.com/tsogs66/MT-Billing.git}"
REPO_BRANCH="${var_repo_branch:-main}"
SERVICE_USER="${var_service_user:-mtbilling}"
API_PORT="${var_api_port:-4000}"
PANEL_PORT="${var_panel_port:-80}"
ADMIN_USER="${var_admin_user:-admin}"
ADMIN_PASS="${var_admin_pass:-admin123}"

msg_info "Installing Dependencies"
$STD apt-get install -y \
  curl \
  git \
  ca-certificates \
  openssl \
  build-essential \
  python3 \
  nginx
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

if ! id "$SERVICE_USER" &>/dev/null; then
  msg_info "Creating service user ${SERVICE_USER}"
  $STD useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  msg_ok "Created service user"
fi

msg_info "Cloning MT-Billing (${REPO_BRANCH})"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  $STD git -C "$INSTALL_DIR" fetch origin
  $STD git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
  $STD git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH" || true
else
  $STD mkdir -p "$(dirname "$INSTALL_DIR")"
  $STD git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
msg_ok "Cloned MT-Billing"

msg_info "Building application (npm install + production build)"
$STD chown -R "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_DIR"
$STD sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR' && npm install && npm run build && npm --prefix server run build"
msg_ok "Built application"

msg_info "Writing server environment"
JWT_SECRET="${var_jwt_secret:-}"
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
fi
$STD mkdir -p "$INSTALL_DIR/server/data"
cat >"$INSTALL_DIR/server/.env" <<EOF
PORT=${API_PORT}
JWT_SECRET=${JWT_SECRET}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
EOF
$STD chmod 600 "$INSTALL_DIR/server/.env"
$STD chown "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_DIR/server/.env" "$INSTALL_DIR/server/data"
msg_ok "Wrote server environment"

msg_info "Creating systemd service (mt-billing-api)"
cat >/etc/systemd/system/mt-billing-api.service <<EOF
[Unit]
Description=MT-Billing API (MikroTik billing panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/server
EnvironmentFile=${INSTALL_DIR}/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
$STD systemctl daemon-reload
$STD systemctl enable mt-billing-api
$STD systemctl restart mt-billing-api
msg_ok "Created systemd service"

msg_info "Configuring nginx (port ${PANEL_PORT})"
cat >/etc/nginx/sites-available/mt-billing <<EOF
server {
    listen ${PANEL_PORT};
    listen [::]:${PANEL_PORT};
    server_name _;

    root ${INSTALL_DIR}/client/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
$STD ln -sf /etc/nginx/sites-available/mt-billing /etc/nginx/sites-enabled/mt-billing
$STD rm -f /etc/nginx/sites-enabled/default
$STD nginx -t
$STD systemctl enable nginx
$STD systemctl reload nginx
msg_ok "Configured nginx"

motd_ssh
customize
cleanup_lxc
