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

**Updates:** new commits on `main` are applied automatically every 10 minutes via `mt-billing-auto-update.timer` (enabled by default). Manual update from the Proxmox host: `sudo bash scripts/proxmox-update.sh`.

**Big updates / factory reinstall:** `sudo bash scripts/proxmox-reinstall.sh --yes` (backs up data, reclones from GitHub, rebuilds; use `--keep-db` to preserve SQLite). Guest script: `install/mt-billing-reinstall.sh`.

---

## Raspberry Pi / Orange Pi / PC (flash image)

Build **one flashable `.img` (and `.img.xz`) per platform**, then write it with **Balena Etcher** or **Rufus** (DD Image mode).

| Item | Raspberry Pi | Orange Pi | PC (amd64) |
|------|--------------|-----------|------------|
| Target | Pi 3 / 4 / 5 (64-bit) | Orange Pi 5 (default); other boards via `OPI_IMAGE_URL` | UEFI x86_64 PC / mini-PC / NUC |
| Base OS | Raspberry Pi OS Lite 64-bit | Armbian Bookworm minimal | Ubuntu 24.04 server cloud image |
| Storage | microSD **≥ 16 GB** (32 GB recommended) | microSD / eMMC **≥ 16 GB** | USB / SSD / NVMe **≥ 16 GB** (32 GB+) |
| Power | Official PSU for your board | Adequate 5V supply for the board | Standard ATX / adapter |
| Network | Ethernet preferred (Wi‑Fi OK) | Ethernet preferred | Ethernet preferred |
| First boot | Online install of MT-Billing | Same | Same (+ cloud-init NoCloud seed) |

### Build the flash files (Linux)

```bash
git clone https://github.com/tsogs66/MT-Billing.git
cd MT-Billing

# Raspberry Pi → dist/flash/mt-billing-rpi-arm64.img (+ .img.xz)
sudo bash scripts/build-rpi-img.sh

# Orange Pi 5 → dist/flash/mt-billing-opi-arm64.img (+ .img.xz)
sudo bash scripts/build-opi-img.sh

# PC amd64 → dist/flash/mt-billing-pc-amd64.img (+ .img.xz)
# requires: sudo apt install qemu-utils
sudo bash scripts/build-pc-img.sh

# All three
sudo bash scripts/build-all-flash-images.sh
```

Other Orange Pi boards: set `OPI_IMAGE_URL` to the matching Armbian `.img.xz` URL, then run `build-opi-img.sh`.
Override PC base with `PC_IMAGE_URL` if needed.

### Flash with Balena Etcher or Rufus

1. Pick the matching file — **do not mix platforms**:
   - Raspberry Pi → `mt-billing-rpi-arm64.img` (or `.img.xz`)
   - Orange Pi → `mt-billing-opi-arm64.img` (or `.img.xz`)
   - PC → `mt-billing-pc-amd64.img` (or `.img.xz`)
2. **Balena Etcher**: Flash from file → select the `.img` or `.img.xz` → select SD/USB → Flash.
3. **Rufus** (Windows): select the `.img` / `.img.xz`, use **DD Image** mode, write to the media.
4. Boot with Ethernet (recommended). Wait for first-boot install to finish.
5. Open `http://<device-ip>/` — panel login `admin` / `admin123`.
6. **PC:** SSH console user from the image seed is `mtadmin` / `mtbilling` (change immediately). UEFI boot recommended.

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
