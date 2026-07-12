#!/usr/bin/env bash
# Copyright (c) 2026 MT-Billing / ts0gs
# License: MIT
# Source: https://github.com/tsogs66/MT-Billing
#
# Install and run Cloudflare Tunnel (cloudflared) so subscriber payment links
# are reachable without opening router ports or using DynDNS.
#
# Cloudflare Zero Trust setup (dashboard):
#   1. Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared)
#   2. Copy the install token shown for the connector
#   3. Public Hostname → Subdomain/Domain → Service: http://localhost:80
#      (or your panel nginx / Vite port)
#
# Usage (inside the MT-Billing guest as root):
#   sudo bash /opt/mt-billing/install/mt-billing-cloudflare-tunnel.sh \
#     --token eyJh... --hostname pay.yourisp.com
#
#   sudo bash /opt/mt-billing/install/mt-billing-cloudflare-tunnel.sh --from-db
#   sudo bash /opt/mt-billing/install/mt-billing-cloudflare-tunnel.sh start
#   sudo bash /opt/mt-billing/install/mt-billing-cloudflare-tunnel.sh stop
#   sudo bash /opt/mt-billing/install/mt-billing-cloudflare-tunnel.sh status
#   sudo bash /opt/mt-billing/install/mt-billing-cloudflare-tunnel.sh uninstall
#
# Options:
#   --token TOKEN     Cloudflare tunnel connector token
#   --hostname HOST   Public hostname (sets pay portal URL to https://HOST)
#   --port N          Local service port cloudflared should reach (default 80)
#                     Note: hostname→service URL is configured in Cloudflare;
#                     --port is stored for panel guidance / nginx checks.
#   --from-db         Read token/hostname/port from app_settings SQLite
#   --no-start        Install/configure but do not start the service
#   -h|--help

set -euo pipefail

INSTALL_DIR="${var_install_dir:-${INSTALL_DIR:-/opt/mt-billing}}"
DB_PATH="${INSTALL_DIR}/server/data/mt-billing.db"
ENV_FILE="${INSTALL_DIR}/server/.env"
CONF_DIR="/etc/mt-billing"
TOKEN_FILE="${CONF_DIR}/cloudflared.token"
UNIT_NAME="cloudflared-mt-billing.service"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}"

TOKEN=""
HOSTNAME=""
LOCAL_PORT="80"
FROM_DB=0
NO_START=0
ACTION=""

log_info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
log_ok() { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
log_err() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }
log_warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }

usage() {
  sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --hostname) HOSTNAME="${2:-}"; shift 2 ;;
    --port) LOCAL_PORT="${2:-80}"; shift 2 ;;
    --from-db) FROM_DB=1; shift ;;
    --no-start) NO_START=1; shift ;;
    start|stop|status|uninstall|apply)
      ACTION="$1"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    -*)
      log_err "Unknown option: $1"
      usage
      exit 1
      ;;
    *)
      log_err "Unexpected argument: $1"
      usage
      exit 1
      ;;
  esac
done

# Default action: apply (install + configure + start)
if [[ -z "$ACTION" ]]; then
  ACTION="apply"
fi

if [[ "$(id -u)" -ne 0 ]]; then
  log_err "Run as root (e.g. sudo bash $0 --token … --hostname pay.yourisp.com)"
  exit 1
fi

normalize_host() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's|^https\?://||' -e 's|/.*||' -e 's|:.*||' -e 's/\.$//'
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
    sqlite3 "$DB_PATH" "UPDATE app_settings SET public_base_url = '${base//\'/\'\'}', cf_tunnel_url = '${base//\'/\'\'}', cf_tunnel_status = 'running', cf_tunnel_enabled = 1 WHERE id = 1;" 2>/dev/null || true
  fi
}

set_db_status() {
  local status="$1"
  local url="${2:-}"
  if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    if [[ -n "$url" ]]; then
      sqlite3 "$DB_PATH" "UPDATE app_settings SET cf_tunnel_status = '${status//\'/\'\'}', cf_tunnel_url = '${url//\'/\'\'}', cf_tunnel_enabled = $([[ "$status" == running ]] && echo 1 || echo 0) WHERE id = 1;" 2>/dev/null || true
    else
      sqlite3 "$DB_PATH" "UPDATE app_settings SET cf_tunnel_status = '${status//\'/\'\'}', cf_tunnel_enabled = $([[ "$status" == running ]] && echo 1 || echo 0) WHERE id = 1;" 2>/dev/null || true
    fi
  fi
}

read_from_db() {
  if [[ ! -f "$DB_PATH" ]] || ! command -v sqlite3 >/dev/null 2>&1; then
    log_err "Cannot read settings from DB ($DB_PATH)"
    exit 1
  fi
  local row
  row="$(sqlite3 -separator '|' "$DB_PATH" "SELECT IFNULL(cf_tunnel_token,''), IFNULL(cf_tunnel_hostname,''), IFNULL(cf_tunnel_port,80) FROM app_settings WHERE id = 1;" 2>/dev/null || true)"
  if [[ -z "$row" ]]; then
    log_err "No app_settings row found"
    exit 1
  fi
  IFS='|' read -r TOKEN HOSTNAME LOCAL_PORT <<<"$row"
  LOCAL_PORT="${LOCAL_PORT:-80}"
}

install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    log_ok "cloudflared already installed: $(cloudflared --version 2>/dev/null | head -1 || echo ok)"
    return 0
  fi
  log_info "Installing cloudflared"
  local arch
  arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
  case "$arch" in
    amd64|x86_64) arch="amd64" ;;
    arm64|aarch64) arch="arm64" ;;
    armhf|armv7*) arch="arm" ;;
    *)
      log_err "Unsupported architecture: $arch"
      exit 1
      ;;
  esac

  local deb="/tmp/cloudflared-linux-${arch}.deb"
  local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
  if ! curl -fsSL "$url" -o "$deb"; then
    log_err "Failed to download cloudflared from GitHub releases"
    exit 1
  fi
  DEBIAN_FRONTEND=noninteractive dpkg -i "$deb" >/dev/null || apt-get install -f -y >/dev/null
  rm -f "$deb"
  if ! command -v cloudflared >/dev/null 2>&1; then
    log_err "cloudflared install failed"
    exit 1
  fi
  log_ok "Installed $(cloudflared --version 2>/dev/null | head -1)"
}

write_unit() {
  mkdir -p "$CONF_DIR"
  chmod 750 "$CONF_DIR"
  if [[ -z "$TOKEN" ]]; then
    log_err "Tunnel token is required"
    exit 1
  fi
  umask 077
  printf '%s\n' "$TOKEN" >"$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"

  cat >"$UNIT_PATH" <<EOF
[Unit]
Description=Cloudflare Tunnel for MT-Billing pay portal
Documentation=https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Restart=on-failure
RestartSec=5
Environment=TUNNEL_TOKEN_FILE=${TOKEN_FILE}
ExecStart=/bin/bash -c 'exec /usr/bin/cloudflared tunnel --no-autoupdate run --token "\$(cat ${TOKEN_FILE})"'
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  # Prefer cloudflared on PATH if not at /usr/bin
  if [[ ! -x /usr/bin/cloudflared ]] && command -v cloudflared >/dev/null 2>&1; then
    local bin
    bin="$(command -v cloudflared)"
    sed -i "s|/usr/bin/cloudflared|${bin}|g" "$UNIT_PATH"
  fi

  systemctl daemon-reload
  systemctl enable "$UNIT_NAME" >/dev/null 2>&1 || true
  log_ok "systemd unit ${UNIT_NAME} installed"
}

do_start() {
  if [[ ! -f "$UNIT_PATH" ]]; then
    log_err "Service not installed. Run apply first (with --token / --from-db)."
    exit 1
  fi
  systemctl start "$UNIT_NAME"
  sleep 1
  if systemctl is-active --quiet "$UNIT_NAME"; then
    local url=""
    if [[ -n "$HOSTNAME" ]]; then
      HOSTNAME="$(normalize_host "$HOSTNAME")"
      url="https://${HOSTNAME}"
      set_public_base_url "$url"
    else
      set_db_status "running"
    fi
    log_ok "Cloudflare Tunnel running"
    [[ -n "$url" ]] && echo "  Pay portal : ${url}/pay/<token>"
  else
    set_db_status "error"
    log_err "Service failed to start — check: journalctl -u ${UNIT_NAME} -n 50"
    systemctl status "$UNIT_NAME" --no-pager -l || true
    exit 1
  fi
}

do_stop() {
  systemctl stop "$UNIT_NAME" 2>/dev/null || true
  set_db_status "stopped"
  log_ok "Cloudflare Tunnel stopped"
}

do_status() {
  local active="stopped"
  if systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    active="running"
  elif systemctl is-failed --quiet "$UNIT_NAME" 2>/dev/null; then
    active="error"
  fi
  local url=""
  if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    url="$(sqlite3 "$DB_PATH" "SELECT IFNULL(cf_tunnel_url,'') FROM app_settings WHERE id = 1;" 2>/dev/null || true)"
  fi
  if [[ -z "$url" && -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    local h
    h="$(sqlite3 "$DB_PATH" "SELECT IFNULL(cf_tunnel_hostname,'') FROM app_settings WHERE id = 1;" 2>/dev/null || true)"
    [[ -n "$h" ]] && url="https://$(normalize_host "$h")"
  fi
  set_db_status "$active" "$url"
  echo "status=${active}"
  echo "url=${url}"
  echo "unit=${UNIT_NAME}"
  systemctl is-active "$UNIT_NAME" 2>/dev/null || true
  return 0
}

do_uninstall() {
  systemctl stop "$UNIT_NAME" 2>/dev/null || true
  systemctl disable "$UNIT_NAME" 2>/dev/null || true
  rm -f "$UNIT_PATH"
  rm -f "$TOKEN_FILE"
  systemctl daemon-reload 2>/dev/null || true
  set_db_status "stopped"
  log_ok "Cloudflare Tunnel service removed (cloudflared binary left installed)"
}

do_apply() {
  if [[ "$FROM_DB" == "1" ]]; then
    read_from_db
  fi
  HOSTNAME="$(normalize_host "${HOSTNAME}")"
  if [[ -z "$TOKEN" ]]; then
    log_err "Missing tunnel token. Pass --token or save it in System Settings and use --from-db."
    exit 1
  fi
  if [[ -z "$HOSTNAME" ]]; then
    log_warn "No hostname set — tunnel will run, but set hostname so pay links use https://your.domain"
  fi

  if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" "UPDATE app_settings SET cf_tunnel_token = '${TOKEN//\'/\'\'}', cf_tunnel_hostname = '${HOSTNAME//\'/\'\'}', cf_tunnel_port = ${LOCAL_PORT:-80} WHERE id = 1;" 2>/dev/null || true
  fi

  install_cloudflared
  write_unit

  if [[ -n "$HOSTNAME" ]]; then
    log_info "Ensure Cloudflare Public Hostname '${HOSTNAME}' → http://127.0.0.1:${LOCAL_PORT}"
  fi

  if [[ "$NO_START" == "1" ]]; then
    set_db_status "stopped"
    log_ok "Configured (not started)"
    return 0
  fi
  do_start

  if systemctl is-active --quiet mt-billing-api 2>/dev/null; then
    log_info "Restarting mt-billing-api to load PUBLIC_BASE_URL"
    systemctl restart mt-billing-api || true
  fi

  echo
  log_ok "Done"
  echo "  Hostname    : ${HOSTNAME:-'(set in Cloudflare + panel)'}"
  echo "  Local port  : ${LOCAL_PORT} (must match Cloudflare service URL)"
  echo "  Pay links   : https://${HOSTNAME:-YOUR_HOST}/pay/<token>"
  echo
  echo "Checklist:"
  echo "  1. Cloudflare Tunnel public hostname points to http://127.0.0.1:${LOCAL_PORT}"
  echo "  2. nginx (or the panel) is listening on that port"
  echo "  3. Payment Links → Active base shows https://${HOSTNAME:-YOUR_HOST}"
  echo "  4. Open a pay link from mobile data (not Wi‑Fi)"
}

case "$ACTION" in
  apply) do_apply ;;
  start)
    [[ "$FROM_DB" == "1" ]] && read_from_db
    # Prefer hostname from DB if not passed
    if [[ -z "$HOSTNAME" && -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
      HOSTNAME="$(sqlite3 "$DB_PATH" "SELECT IFNULL(cf_tunnel_hostname,'') FROM app_settings WHERE id = 1;" 2>/dev/null || true)"
    fi
    do_start
    ;;
  stop) do_stop ;;
  status) do_status ;;
  uninstall) do_uninstall ;;
  *)
    log_err "Unknown action: $ACTION"
    exit 1
    ;;
esac
