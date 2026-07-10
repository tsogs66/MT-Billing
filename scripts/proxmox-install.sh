#!/usr/bin/env bash
# MT-Billing — Proxmox installation helper
#
# Run on a Proxmox VE node to create an Ubuntu LXC, then inside that guest to
# install Node.js, build the panel, and configure nginx + systemd.
#
#   # 1) On the Proxmox host (root):
#   ./scripts/proxmox-install.sh create-lxc
#
#   # 2) Inside the new Ubuntu container/VM (root or sudo):
#   curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/scripts/proxmox-install.sh | sudo bash -s -- install
#   # — or, from a cloned repo:
#   sudo ./scripts/proxmox-install.sh install --source /opt/mt-billing
#
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REPO_URL="${REPO_URL:-https://github.com/tsogs66/MT-Billing.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/mt-billing}"
SERVICE_USER="${SERVICE_USER:-mtbilling}"
API_PORT="${API_PORT:-4000}"
PANEL_PORT="${PANEL_PORT:-80}"

# --- LXC defaults (override with env or flags) ---
CTID="${CTID:-120}"
CT_HOSTNAME="${CT_HOSTNAME:-mt-billing}"
CT_MEMORY="${CT_MEMORY:-2048}"
CT_CORES="${CT_CORES:-2}"
CT_DISK="${CT_DISK:-20}"
CT_STORAGE="${CT_STORAGE:-local-lvm}"
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_TEMPLATE="${CT_TEMPLATE:-ubuntu-24.04-standard}"
CT_IP="${CT_IP:-dhcp}"          # e.g. 192.168.1.50/24 or dhcp
CT_GW="${CT_GW:-}"              # required when CT_IP is static
CT_DNS="${CT_DNS:-1.1.1.1}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

as_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Run as root (or with sudo)."
}

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME <command> [options]

Commands:
  create-lxc     Create an Ubuntu LXC on this Proxmox node (run on Proxmox host)
  install        Install MT-Billing inside Ubuntu VM/LXC (run inside the guest)
  help           Show this help

create-lxc options (env vars or flags):
  --ctid N           Container ID (default: $CTID)
  --hostname NAME    Hostname (default: $CT_HOSTNAME)
  --storage NAME     Proxmox storage (default: $CT_STORAGE)
  --bridge NAME      Network bridge (default: $CT_BRIDGE)
  --memory MB        RAM in MB (default: $CT_MEMORY)
  --cores N          CPU cores (default: $CT_CORES)
  --disk GB          Root disk size in GB (default: $CT_DISK)
  --template NAME    OS template name (default: $CT_TEMPLATE)
  --ip CIDR|dhcp     IP address or dhcp (default: $CT_IP)
  --gw ADDR          Gateway (required for static IP)
  --dns ADDR         DNS server (default: $CT_DNS)

install options:
  --dir PATH         Install directory (default: $INSTALL_DIR)
  --source PATH      Use existing repo checkout instead of cloning
  --branch NAME      Git branch to clone (default: $REPO_BRANCH)
  --repo URL         Git repository URL
  --api-port PORT    API listen port (default: $API_PORT)
  --panel-port PORT  nginx HTTP port (default: $PANEL_PORT)
  --no-nginx         Skip nginx; API systemd service only
  --no-clone         Expect source at --dir (already present)

Examples:
  # Proxmox host — create container 130 with static IP
  $SCRIPT_NAME create-lxc --ctid 130 --ip 192.168.88.10/24 --gw 192.168.88.1

  # Guest — install from GitHub
  curl -fsSL .../proxmox-install.sh | sudo bash -s -- install

  # Guest — install from local clone
  sudo $SCRIPT_NAME install --source "\$(pwd)"
EOF
}

parse_create_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ctid) CTID="$2"; shift 2 ;;
      --hostname) CT_HOSTNAME="$2"; shift 2 ;;
      --storage) CT_STORAGE="$2"; shift 2 ;;
      --bridge) CT_BRIDGE="$2"; shift 2 ;;
      --memory) CT_MEMORY="$2"; shift 2 ;;
      --cores) CT_CORES="$2"; shift 2 ;;
      --disk) CT_DISK="$2"; shift 2 ;;
      --template) CT_TEMPLATE="$2"; shift 2 ;;
      --ip) CT_IP="$2"; shift 2 ;;
      --gw) CT_GW="$2"; shift 2 ;;
      --dns) CT_DNS="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown create-lxc option: $1" ;;
    esac
  done
}

SOURCE_DIR=""
NO_NGINX=0
NO_CLONE=0

parse_install_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dir) INSTALL_DIR="$2"; shift 2 ;;
      --source) SOURCE_DIR="$2"; shift 2 ;;
      --branch) REPO_BRANCH="$2"; shift 2 ;;
      --repo) REPO_URL="$2"; shift 2 ;;
      --api-port) API_PORT="$2"; shift 2 ;;
      --panel-port) PANEL_PORT="$2"; shift 2 ;;
      --no-nginx) NO_NGINX=1; shift ;;
      --no-clone) NO_CLONE=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown install option: $1" ;;
    esac
  done
}

ensure_template() {
  local storage="${1:-local}"
  if pveam list "$storage" 2>/dev/null | awk '{print $2}' | grep -q "^${CT_TEMPLATE}"; then
    log "Template $CT_TEMPLATE already available on $storage"
    return
  fi
  log "Downloading template ${CT_TEMPLATE} to storage $storage (this may take a minute)…"
  pveam update
  pveam download "$storage" "$CT_TEMPLATE" || \
    die "Could not download template $CT_TEMPLATE. Run: pveam available | grep ubuntu"
}

resolve_template_path() {
  local storage="${1:-local}"
  local file
  file="$(pveam list "$storage" 2>/dev/null | awk '{print $2}' | grep "^${CT_TEMPLATE}" | head -1)"
  [[ -n "$file" ]] || die "Template file for $CT_TEMPLATE not found on $storage"
  printf '%s:vztmpl/%s' "$storage" "$file"
}

cmd_create_lxc() {
  parse_create_args "$@"
  as_root
  need_cmd pct
  need_cmd pveam

  if pct status "$CTID" &>/dev/null; then
    die "Container CT $CTID already exists. Pick another --ctid."
  fi

  local template_storage="local"
  ensure_template "$template_storage"
  local template_path
  template_path="$(resolve_template_path "$template_storage")"

  log "Creating LXC $CTID ($CT_HOSTNAME) — ${CT_MEMORY}MB RAM, ${CT_CORES} cores, ${CT_DISK}G disk"

  local net0="name=eth0,bridge=${CT_BRIDGE},ip=${CT_IP}"
  if [[ "$CT_IP" != "dhcp" && -n "$CT_GW" ]]; then
    net0="${net0},gw=${CT_GW}"
  fi

  pct create "$CTID" "$template_path" \
    --hostname "$CT_HOSTNAME" \
    --memory "$CT_MEMORY" \
    --cores "$CT_CORES" \
    --rootfs "${CT_STORAGE}:${CT_DISK}" \
    --net0 "$net0" \
    --nameserver "$CT_DNS" \
    --unprivileged 1 \
    --features nesting=0 \
    --onboot 1 \
    --start 1

  log "Waiting for container network…"
  sleep 5

  local guest_ip
  guest_ip="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"

  local raw_base="${REPO_URL%.git}"
  raw_base="${raw_base/https:\/\/github.com\//https://raw.githubusercontent.com/}"

  cat <<EOF

╔══════════════════════════════════════════════════════════════╗
║  LXC $CTID ($CT_HOSTNAME) created and started                ║
╚══════════════════════════════════════════════════════════════╝

  Guest IP (approx): ${guest_ip:-see: pct exec $CTID -- hostname -I}

  Next steps — run INSIDE the container:

    pct enter $CTID

    apt update && apt install -y curl git ca-certificates
    curl -fsSL ${raw_base}/${REPO_BRANCH}/scripts/proxmox-install.sh -o /tmp/proxmox-install.sh
    bash /tmp/proxmox-install.sh install

  Or from your workstation:

    ssh root@\${guest_ip}
    # then run the install command above

EOF
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge 20 ]]; then
      log "Node.js $(node -v) already installed"
      return
    fi
    warn "Node.js $(node -v) is too old; installing Node 22…"
  fi
  log "Installing Node.js 22.x…"
  need_cmd curl
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  log "Node $(node -v), npm $(npm -v)"
}

install_build_deps() {
  log "Installing build dependencies (better-sqlite3)…"
  apt-get install -y build-essential python3
}

sync_source() {
  if [[ -n "$SOURCE_DIR" ]]; then
    log "Copying source from $SOURCE_DIR → $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --delete --exclude node_modules --exclude server/data --exclude .git "$SOURCE_DIR/" "$INSTALL_DIR/"
    else
      cp -a "$SOURCE_DIR/." "$INSTALL_DIR/"
    fi
    return
  fi

  if [[ "$NO_CLONE" -eq 1 ]]; then
    [[ -d "$INSTALL_DIR" ]] || die "Install dir $INSTALL_DIR does not exist (--no-clone)"
    return
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Updating existing clone at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch origin
    git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH" || true
  else
    log "Cloning $REPO_URL (branch $REPO_BRANCH) → $INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
}

write_env_file() {
  local env_file="$INSTALL_DIR/server/.env"
  if [[ -f "$env_file" ]] && grep -q '^JWT_SECRET=' "$env_file" 2>/dev/null; then
    local secret
    secret="$(grep '^JWT_SECRET=' "$env_file" | cut -d= -f2-)"
    [[ "$secret" != "change-me-in-production" && -n "$secret" ]] && {
      log "Keeping existing $env_file"
      return
    }
  fi
  local jwt
  jwt="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
  log "Writing $env_file"
  cat >"$env_file" <<EOF
PORT=$API_PORT
JWT_SECRET=$jwt
ADMIN_USER=admin
ADMIN_PASS=admin123
EOF
  chmod 600 "$env_file"
  warn "Default login: admin / admin123 — change after first sign-in."
}

setup_systemd() {
  log "Creating systemd service mt-billing-api"
  cat >/etc/systemd/system/mt-billing-api.service <<EOF
[Unit]
Description=MT-Billing API (MikroTik billing panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/server
EnvironmentFile=$INSTALL_DIR/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable mt-billing-api
  systemctl restart mt-billing-api
}

setup_nginx() {
  [[ "$NO_NGINX" -eq 1 ]] && return
  log "Configuring nginx on port $PANEL_PORT"
  apt-get install -y nginx
  cat >/etc/nginx/sites-available/mt-billing <<EOF
server {
    listen ${PANEL_PORT};
    listen [::]:${PANEL_PORT};
    server_name _;

    root $INSTALL_DIR/client/dist;
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
  systemctl enable nginx
  systemctl reload nginx
}

cmd_install() {
  parse_install_args "$@"
  as_root

  log "MT-Billing guest installer (Ubuntu on Proxmox VM/LXC)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y curl git ca-certificates openssl

  install_node
  install_build_deps
  sync_source

  if ! id "$SERVICE_USER" &>/dev/null; then
    log "Creating service user $SERVICE_USER"
    useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi

  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

  log "Installing npm dependencies and building…"
  sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR' && npm install && npm run build && npm --prefix server run build"

  write_env_file
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/server/.env"
  mkdir -p "$INSTALL_DIR/server/data"
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/server/data"

  setup_systemd
  setup_nginx

  local url="http://$(hostname -I | awk '{print $1}'):${PANEL_PORT}"
  [[ "$NO_NGINX" -eq 1 ]] && url="http://$(hostname -I | awk '{print $1}'):${API_PORT}"

  cat <<EOF

╔══════════════════════════════════════════════════════════════╗
║  MT-Billing installation complete                            ║
╚══════════════════════════════════════════════════════════════╝

  Panel URL:  $url
  Login:      admin / admin123  (change immediately)

  Service:    systemctl status mt-billing-api
  Logs:       journalctl -u mt-billing-api -f
  Data:       $INSTALL_DIR/server/data/mt-billing.db

  Firewall (if ufw enabled):
    ufw allow ${PANEL_PORT}/tcp
    ufw allow ${API_PORT}/tcp   # only if exposing API directly

EOF
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    create-lxc) cmd_create_lxc "$@" ;;
    install)    cmd_install "$@" ;;
    help|-h|--help) usage ;;
    *) die "Unknown command: $cmd (try: $SCRIPT_NAME help)" ;;
  esac
}

main "$@"
