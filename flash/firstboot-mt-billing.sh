#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / Pa-North
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# First-boot installer for Raspberry Pi / Orange Pi flash images.
# Runs once via systemd, installs Node.js + MT-Billing, configures nginx.

set -euo pipefail

INSTALL_DIR="${MT_INSTALL_DIR:-/opt/mt-billing}"
REPO_URL="${MT_REPO_URL:-https://github.com/tsogs66/MT-Billing.git}"
REPO_BRANCH="${MT_REPO_BRANCH:-main}"
SERVICE_USER="${MT_SERVICE_USER:-mtbilling}"
API_PORT="${MT_API_PORT:-4000}"
PANEL_PORT="${MT_PANEL_PORT:-80}"
ADMIN_USER="${MT_ADMIN_USER:-admin}"
ADMIN_PASS="${MT_ADMIN_PASS:-admin123}"
LOG="${MT_FIRSTBOOT_LOG:-/var/log/mt-billing-firstboot.log}"

exec > >(tee -a "$LOG") 2>&1
echo "==== MT-Billing first-boot $(date -Is) ===="

export DEBIAN_FRONTEND=noninteractive

detect_board() {
  local model=""
  [[ -f /proc/device-tree/model ]] && model="$(tr -d '\0' </proc/device-tree/model)"
  echo "Board model: ${model:-unknown}"
  if echo "$model" | grep -qiE 'raspberry|bcm27|bcm28'; then
    echo "Detected: Raspberry Pi"
  elif echo "$model" | grep -qiE 'orange|sun|rockchip|xunlong'; then
    echo "Detected: Orange Pi / Armbian SBC"
  else
    echo "Detected: generic ARM/Debian host"
  fi
}

detect_board

# Ensure SSH is available for headless access (RPi/OPi).
systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true
# Raspberry Pi OS: also drop the boot marker when the firmware partition is mounted.
for d in /boot/firmware /boot; do
  if [[ -d "$d" && -w "$d" ]]; then
    touch "$d/ssh" 2>/dev/null || true
  fi
done

echo "[1/7] Installing OS packages…"
apt-get update -y
apt-get install -y \
  curl git ca-certificates openssl build-essential python3 \
  libsqlite3-dev nginx xz-utils

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | tr -d v | cut -d. -f1)" -lt 20 ]]; then
  echo "[2/7] Installing Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "[2/7] Node.js already present: $(node -v)"
fi

if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "[3/7] Cloning MT-Billing (${REPO_BRANCH})…"
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH" || true
else
  rm -rf "$INSTALL_DIR"
  git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_DIR"

echo "[4/7] Building application…"
sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR' && npm install && npm run build && npm --prefix server run build"

echo "[5/7] Writing environment…"
JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
mkdir -p "$INSTALL_DIR/server/data"
cat >"$INSTALL_DIR/server/.env" <<EOF
PORT=${API_PORT}
JWT_SECRET=${JWT_SECRET}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
EOF
chmod 600 "$INSTALL_DIR/server/.env"
chown "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_DIR/server/.env" "$INSTALL_DIR/server/data"

echo "[6/7] Enabling systemd + nginx…"
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
ln -sf /etc/nginx/sites-available/mt-billing /etc/nginx/sites-enabled/mt-billing
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
systemctl enable --now mt-billing-api
systemctl enable nginx
systemctl reload nginx

echo "[7/7] Disabling first-boot unit…"
systemctl disable mt-billing-firstboot.service 2>/dev/null || true
rm -f /etc/systemd/system/mt-billing-firstboot.service
systemctl daemon-reload

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "==== MT-Billing first-boot complete ===="
echo "Panel: http://${IP:-<device-ip>}/"
echo "Login: ${ADMIN_USER} / ${ADMIN_PASS}  (change immediately)"
