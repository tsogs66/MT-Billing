# MT-Billing

A self-hosted **MikroTik billing and PPPoE/IPoE management panel** (branding: *Pa-North*),
designed to run on **Ubuntu** (e.g. an Ubuntu VM/LXC on Proxmox).

It gives WISP / fiber ISP operators a single dashboard to manage RouterOS devices,
PPPoE & IPoE subscribers, billing plans, a fiber clients map (OLT → NAP → client
topology), sales reporting, hotspot vouchers, inventory and more.

## Features

- **Dashboard** – live host stats (CPU/RAM/disk of the Ubuntu host, via
  `systeminformation`), per-router status (active / offline / expired PPPoE),
  sales overview chart and queue-tree ranking.
- **PPPoE & IPoE Management** – users, offline users, active connections,
  profiles, servers and billing plans, with create/edit/delete.
- **Clients Map** – Leaflet map plotting OLT, NAP boxes and subscribers with
  **animated** server → OLT → NAP → ONU topology links and per-ONU online/offline
  status (pulsing markers, live counts, auto-refresh).
- **Billing / Payments** – executing a payment extends the subscription by whole
  month(s) anchored on the **original expiration date** (the billing day-of-month
  is preserved and never re-anchored to the payment day).
- **Uptime Monitor** – live reachability + latency monitoring of the most popular
  services, sites and games (Google, YouTube, Facebook, Steam, Roblox, Riot,
  Cloudflare/Google DNS, etc.) grouped by category with sparklines and uptime %.
- **Sales Report** – revenue chart (7d / 30d / 6m / 1y) and recent transactions.
- **Stock & Inventory**, **Hotspot vouchers**, **Company profile**, **System Logs**,
  plus placeholders for AI Scripting, Terminal, Network, Mikrotik Files, ZeroTier,
  Panel Roles, Updater, Super Router and License.
- **MikroTik RouterOS API integration** (`node-routeros`) with graceful fallback
  to a seeded local database, so the panel is fully usable during development
  without live hardware.

## Tech stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, React Router, Recharts, Leaflet |
| Backend  | Node.js, Express, TypeScript (run via `tsx`), better-sqlite3, JWT auth |
| Database | SQLite (auto-created and seeded on first run at `server/data/mt-billing.db`) |

## Requirements

See **[SYSTEM_REQUIREMENTS.md](./SYSTEM_REQUIREMENTS.md)** for full hardware and software minimums.

| Deployment | Minimum |
|------------|---------|
| **App (any host)** | 2 CPU · 2 GB RAM · 16 GB disk · Node.js 20+ · Ubuntu 22.04/24.04 or Debian 12 |
| **Proxmox LXC** | Proxmox VE 7.4+ · **2 vCPU · 4 GB RAM · 32 GB disk** (script defaults) |
| **Raspberry Pi** | Pi 3/4/5 64-bit · 16 GB+ microSD · flash `mt-billing-rpi-arm64.img.xz` |
| **Orange Pi** | OPi 5 (or Armbian board image) · 16 GB+ storage · flash `mt-billing-opi-arm64.img.xz` |

## Getting started (development)

```bash
# From the repository root – installs root, server and client deps
npm install

# Start the API (http://localhost:4000) and the web UI (http://localhost:5173) together
npm run dev
```

Then open <http://localhost:5173> and sign in with the default credentials:

```
username: admin
password: admin123
```

The SQLite database is created and seeded automatically on first run.

### Configuration

Server settings are read from `server/.env` (see `server/.env.example`):

| Variable     | Default                  | Purpose |
|--------------|--------------------------|---------|
| `PORT`       | `4000`                   | API port |
| `JWT_SECRET` | `change-me-in-production`| JWT signing secret |
| `ADMIN_USER` | `admin`                  | Default admin username (first run only) |
| `ADMIN_PASS` | `admin123`               | Default admin password (first run only) |

To connect a real router, add its host / API credentials in the `routers` table
(the API layer will use live RouterOS data when reachable and fall back to seeded
data otherwise).

## Useful scripts

| Command             | Description |
|---------------------|-------------|
| `npm run dev`       | Run server + client together (development) |
| `npm run build`     | Type-check and build the frontend for production |
| `npm run lint`      | Lint the frontend |
| `npm --prefix server run build` | Compile the backend to `server/dist` |
| `npm --prefix server run start` | Run the compiled backend |
| `scripts/proxmox-install.sh` | Proxmox host helper → `ct/mt-billing.sh` |
| `scripts/build-rpi-img.sh` | Build Raspberry Pi `.img` (+ `.img.xz`) for Etcher/Rufus |
| `scripts/build-opi-img.sh` | Build Orange Pi `.img` (+ `.img.xz`) for Etcher/Rufus |
| `scripts/build-sbc-flash-image.sh` | Shared builder (`--board rpi\|opi\|all`) |
| `scripts/sync-proxmox-embed.sh` | Sync `install/` into embedded Proxmox guest script |

## Deploying on Ubuntu (Proxmox)

### One-liner (public repo only)

GitHub raw URLs return **404 on private repositories**. Make the repo public first, or use the **local install** below.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/ct/mt-billing.sh)"
```

Unattended:

```bash
mode=default bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/ct/mt-billing.sh)"
```

### Local install (private repo — use this if curl returns 404)

On the **Proxmox host** as root:

```bash
git clone https://github.com/tsogs66/MT-Billing.git
cd MT-Billing
mode=default bash ct/mt-billing.sh
```

The guest install script is **embedded** inside `ct/mt-billing.sh`, so no second download is needed during container setup.

Optional environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `var_repo_branch` | `main` | Git branch to deploy |
| `var_admin_user` | `admin` | First-run admin username |
| `var_admin_pass` | `admin123` | First-run admin password |
| `var_jwt_secret` | *(random)* | JWT signing secret |

Uses [community-scripts](https://github.com/community-scripts/ProxmoxVE) `build.func` for storage/network prompts and container creation. Guest install script: `install/mt-billing-install.sh`.

### Manual install (inside an existing VM/LXC)

```bash
curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/install/mt-billing-install.sh | bash
```

Or step by step:

1. Create an Ubuntu 22.04/24.04 VM or LXC on Proxmox.
2. Install Node.js 20+ and `git`.
3. Clone the repo, run `npm install`, then `npm run build` and
   `npm --prefix server run build`.
4. Serve `client/dist` with nginx and run the compiled API (`npm --prefix server run start`) via
   `systemd`. Point the reverse proxy at the API on `PORT`.

## Deploying on Raspberry Pi / Orange Pi (flash image)

Build one compressed disk image **per board**, then flash with **Balena Etcher** or **Rufus** (DD mode):

```bash
sudo bash scripts/build-rpi-img.sh   # → dist/flash/mt-billing-rpi-arm64.img
sudo bash scripts/build-opi-img.sh   # → dist/flash/mt-billing-opi-arm64.img
```

Details: [flash/README.md](./flash/README.md) · [SYSTEM_REQUIREMENTS.md](./SYSTEM_REQUIREMENTS.md).
