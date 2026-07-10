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

- Node.js 20+ (developed on Node 22)
- npm 10+

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

## Deploying on Ubuntu (Proxmox)

1. Create an Ubuntu 22.04/24.04 VM or LXC on Proxmox.
2. Install Node.js 20+ and `git`.
3. Clone the repo, run `npm install`, then `npm run build` and
   `npm --prefix server run build`.
4. Serve `client/dist` with a static server / reverse proxy (nginx) and run the
   compiled API (`npm --prefix server run start`) behind it, e.g. under
   `systemd`. Point the frontend/reverse proxy at the API on `PORT`.
