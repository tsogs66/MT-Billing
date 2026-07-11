# System requirements

MT-Billing (Pa-North) can run on a **Proxmox LXC/VM**, a **Raspberry Pi**, or an **Orange Pi**.
Pick one deployment path below.

## Shared application requirements

| Item | Minimum | Recommended |
|------|---------|-------------|
| OS | Ubuntu 22.04 / 24.04, Debian 12 (Bookworm) | Ubuntu 24.04 LTS |
| CPU | 2 cores (aarch64 or x86_64) | 4 cores |
| RAM | 2 GB | 4 GB |
| Disk | 16 GB free | 32 GB+ SSD / high-endurance SD |
| Node.js | 20+ | 22 LTS |
| Network | Outbound HTTPS (GitHub, npm) | Static LAN IP for the panel |
| Browser | Current Chrome / Firefox / Edge | — |

Default panel login after install: **`admin` / `admin123`** (change immediately).

---

## Proxmox VE (LXC helper)

Run on the **Proxmox host** as root.

| Item | Requirement |
|------|-------------|
| Proxmox VE | 7.4+ (8.x recommended) |
| Privileges | Root on the host (`pct` available) |
| Container defaults | **2 vCPU · 4096 MB RAM · 32 GB disk · Ubuntu 24.04 · unprivileged** |
| Storage | Free space ≥ container disk (32 GB default) |
| Network | Bridge (e.g. `vmbr0`) with DHCP or a free static IP |
| Internet | Host must reach GitHub + npm + [community-scripts](https://github.com/community-scripts/ProxmoxVE) |

```bash
# Public repo one-liner
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/MT-Billing/main/ct/mt-billing.sh)"

# Or from a clone
sudo bash scripts/proxmox-install.sh
```

Unattended: `mode=default sudo bash scripts/proxmox-install.sh`

Guest install script: `install/mt-billing-install.sh` (also embedded in `ct/mt-billing.sh`).

---

## Raspberry Pi / Orange Pi (flash image)

Build **one flashable `.img.xz` per board**, then write it with **Balena Etcher** or **Rufus**.

| Item | Raspberry Pi | Orange Pi |
|------|--------------|-----------|
| Boards | Pi 3 / 4 / 5 (64-bit) | Orange Pi 5 (default image); other boards via `OPI_IMAGE_URL` |
| Base OS | Raspberry Pi OS Lite 64-bit | Armbian Bookworm minimal |
| Storage | microSD **≥ 16 GB** (32 GB recommended) | microSD / eMMC **≥ 16 GB** |
| Power | Official PSU for your board | Adequate 5V supply for the board |
| Network | Ethernet preferred (Wi‑Fi OK) | Ethernet preferred |
| First boot | 5–20 min online install of MT-Billing | Same |

### Build the flash file (Linux)

Separate images per board:

```bash
git clone https://github.com/tsogs66/MT-Billing.git
cd MT-Billing

# Raspberry Pi only → dist/flash/mt-billing-rpi-arm64.img (+ .img.xz)
sudo bash scripts/build-rpi-img.sh

# Orange Pi 5 only → dist/flash/mt-billing-opi-arm64.img (+ .img.xz)
sudo bash scripts/build-opi-img.sh
```

Other Orange Pi boards: set `OPI_IMAGE_URL` to the matching Armbian `.img.xz` URL, then run `build-opi-img.sh`.

### Flash with Balena Etcher or Rufus

1. Use **`mt-billing-rpi-arm64.img`** for Raspberry Pi, or **`mt-billing-opi-arm64.img`** for Orange Pi (do not mix).
2. **Balena Etcher**: Flash from file → select the `.img` or `.img.xz` → select SD/USB → Flash.
3. **Rufus** (Windows): select the `.img` / `.img.xz`, use **DD image** mode, write to the SD card.
4. Insert the card, boot the SBC with Ethernet (recommended), wait for first-boot install to finish.
5. Open `http://<device-ip>/` — login `admin` / `admin123`.

First-boot log on device: `/var/log/mt-billing-firstboot.log`.

---

## Development (laptop / CI)

| Item | Requirement |
|------|-------------|
| Node.js | 20+ (22 recommended) |
| npm | 10+ |
| OS | Linux / macOS / WSL2 |

```bash
npm install
npm run dev
```

UI: <http://localhost:5173> · API: <http://localhost:4000>
