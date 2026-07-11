#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / ts0gs
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# Configure this LXC/VM to host subscriber payment links on a DynDNS (or any)
# public hostname. Sets nginx + PUBLIC_BASE_URL / panel public_base_url.
#
# Usage (inside the MT-Billing guest as root):
#   sudo bash /opt/mt-billing/install/mt-billing-public-host.sh yourname.duckdns.org
#   sudo bash /opt/mt-billing/install/mt-billing-public-host.sh billing.yourisp.dyndns.org --https
#   sudo bash /opt/mt-billing/install/mt-billing-public-host.sh yourname.duckdns.org --pay-only
#
# Prerequisites:
#   1. DynDNS hostname points at your public IP
#   2. Router port-forwards TCP 80 (and 443 if --https) → this LXC
#   3. Outbound DNS works from the LXC
#
# Options:
#   --https       Obtain/renew Let's Encrypt cert via certbot (needs port 80 open)
#   --pay-only    Public vhost only serves /pay/* and /api/public/* (safer)
#   --http-only   Force http:// links (default unless --https succeeds)
#   --port N      HTTP listen port (default 80)
#   --email ADDR  Certbot email (optional)
#   -h|--help     Show help

set -euo pipefail

INSTALL_DIR="${var_install_dir:-${INSTALL_DIR:-/opt/mt-billing}}"
API_PORT="${var_api_port:-${API_PORT:-4000}}"
PANEL_PORT="${var_panel_port:-${PANEL_PORT:-80}}"
HOSTNAME=""
DO_HTTPS=0
PAY_ONLY=0
FORCE_HTTP=0
CERTBOT_EMAIL=""

log_info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
log_ok() { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
log_err() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }
log_warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --https) DO_HTTPS=1; shift ;;
    --pay-only) PAY_ONLY=1; shift ;;
    --http-only) FORCE_HTTP=1; shift ;;
    --port) PANEL_PORT="${2:-80}"; shift 2 ;;
    --email) CERTBOT_EMAIL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*)
      log_err "Unknown option: $1"
      usage
      exit 1
      ;;
    *)
      if [[ -z "$HOSTNAME" ]]; then
        HOSTNAME="$1"
        shift
      else
        log_err "Unexpected argument: $1"
        exit 1
      fi
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  log_err "Run as root (e.g. sudo bash $0 yourname.duckdns.org)"
  exit 1
fi

HOSTNAME="$(printf '%s' "$HOSTNAME" | tr '[:upper:]' '[:lower:]' | sed -e 's|^https\?://||' -e 's|/.*||' -e 's|:.*||' -e 's/\.$//')"
if [[ -z "$HOSTNAME" || "$HOSTNAME" == *' '* ]]; then
  log_err "Pass your DynDNS hostname."
  echo "Example: sudo bash $0 myisp.duckdns.org --https" >&2
  exit 1
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  log_err "Install dir not found: $INSTALL_DIR"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  log_err "nginx is not installed"
  exit 1
fi

DB_PATH="${INSTALL_DIR}/server/data/mt-billing.db"
ENV_FILE="${INSTALL_DIR}/server/.env"
SITE_AVAIL="/etc/nginx/sites-available/mt-billing"
SITE_ENABLED="/etc/nginx/sites-enabled/mt-billing"

write_nginx_http() {
  local pay_block=""
  if [[ "$PAY_ONLY" == "1" ]]; then
    pay_block=$(cat <<'BLOCK'
    # Public payment portal only
    location ^~ /pay/ {
        try_files $uri $uri/ /index.html;
    }
    location ^~ /api/public/ {
        proxy_pass http://127.0.0.1:__API_PORT__/api/public/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # Assets needed by /pay SPA
    location ^~ /assets/ {
        try_files $uri =404;
    }
    location = /index.html {
        try_files /index.html =404;
    }
    location / {
        return 404;
    }
BLOCK
)
    pay_block="${pay_block//__API_PORT__/${API_PORT}}"
  else
    pay_block=$(cat <<EOF
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
EOF
)
  fi

  cat >"$SITE_AVAIL" <<EOF
server {
    listen ${PANEL_PORT};
    listen [::]:${PANEL_PORT};
    server_name ${HOSTNAME};

    root ${INSTALL_DIR}/client/dist;
    index index.html;

${pay_block}
}
EOF
}

set_public_base_url() {
  local base="$1"
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ -f "$ENV_FILE" ]]; then
    if grep -q '^PUBLIC_BASE_URL=' "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${base}|" "$ENV_FILE"
    else
      printf '\nPUBLIC_BASE_URL=%s\n' "$base" >>"$ENV_FILE"
    fi
  else
    printf 'PUBLIC_BASE_URL=%s\n' "$base" >"$ENV_FILE"
  fi

  if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" "UPDATE app_settings SET public_base_url = '${base//\'/\'\'}' WHERE id = 1;" 2>/dev/null || true
  fi
}

log_info "Configuring public pay host for ${HOSTNAME}"
write_nginx_http
ln -sf "$SITE_AVAIL" "$SITE_ENABLED"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx
log_ok "nginx listening on :${PANEL_PORT} for ${HOSTNAME}"

SCHEME="http"
if [[ "$DO_HTTPS" == "1" && "$FORCE_HTTP" != "1" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    log_info "Installing certbot"
    apt-get update -y >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx >/dev/null
  fi
  log_info "Requesting Let's Encrypt certificate (port 80 must reach this host)"
  CERTBOT_ARGS=(--nginx -d "$HOSTNAME" --non-interactive --agree-tos --redirect)
  if [[ -n "$CERTBOT_EMAIL" ]]; then
    CERTBOT_ARGS+=(--email "$CERTBOT_EMAIL")
  else
    CERTBOT_ARGS+=(--register-unsafely-without-email)
  fi
  if certbot "${CERTBOT_ARGS[@]}"; then
    SCHEME="https"
    log_ok "HTTPS enabled for ${HOSTNAME}"
  else
    log_warn "certbot failed — keeping HTTP. Fix DNS/port-forward, then re-run with --https"
  fi
fi

PUBLIC_BASE="${SCHEME}://${HOSTNAME}"
set_public_base_url "$PUBLIC_BASE"
log_ok "Public pay portal URL → ${PUBLIC_BASE}"

if systemctl is-active --quiet mt-billing-api 2>/dev/null; then
  log_info "Restarting mt-billing-api to load PUBLIC_BASE_URL"
  systemctl restart mt-billing-api || true
fi

echo
log_ok "Done"
echo "  DynDNS host : ${HOSTNAME}"
echo "  Pay links   : ${PUBLIC_BASE}/pay/<token>"
echo "  Mode        : $([[ "$PAY_ONLY" == "1" ]] && echo 'pay-only (public)' || echo 'full panel')"
echo
echo "Checklist:"
echo "  1. DynDNS A/AAAA record → your public IP"
echo "  2. Router forward TCP ${PANEL_PORT}$([[ "$SCHEME" == https ]] && echo '/443') → this LXC IP"
echo "  3. In the panel: Payment Links → confirm Active base is ${PUBLIC_BASE}"
echo "  4. Copy a pay link and open it from a phone on mobile data (not Wi‑Fi)"
echo
if [[ "$PAY_ONLY" != "1" ]]; then
  log_warn "Full panel is exposed on DynDNS. Prefer --pay-only for subscriber links, and keep admin on LAN."
fi
