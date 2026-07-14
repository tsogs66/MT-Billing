# Flash images (Raspberry Pi, Orange Pi & PC)

Separate disk images — **one per board/platform**. Download from the
[flash images release](https://github.com/tsogs66/MT-Billing/releases/tag/sbc-flash-images)
or build locally, then flash with **Balena Etcher** or **Rufus** (DD Image mode).

| Platform | Build command | Output files |
|----------|---------------|--------------|
| **Raspberry Pi** 3/4/5 | `sudo bash scripts/build-rpi-img.sh` | `mt-billing-rpi-arm64.img` (+ `.img.xz`) |
| **Orange Pi 5** | `sudo bash scripts/build-opi-img.sh` | `mt-billing-opi-arm64.img` (+ `.img.xz`) |
| **Orange Pi One** (H3) | `sudo bash scripts/build-opi-one-img.sh` | `mt-billing-opi-one-armhf.img` (+ `.img.xz`) |
| **PC** (UEFI amd64) | `sudo bash scripts/build-pc-img.sh` | `mt-billing-pc-amd64.img` (+ `.img.xz`) |

**Do not mix Orange Pi images.** `mt-billing-opi-arm64*` is for Orange Pi **5** only.
Orange Pi **One** must use `mt-billing-opi-one-armhf*`.

Build all:

```bash
sudo bash scripts/build-all-flash-images.sh
```

Host build deps: `curl`, `xz`, `losetup`, `python3`, and for PC images `qemu-utils` (`qemu-img`).

See **[SYSTEM_REQUIREMENTS.md](../SYSTEM_REQUIREMENTS.md)** for hardware minimums.

## After flashing

1. Boot the device with Ethernet (recommended). First boot needs internet.
2. Wait for [`firstboot-mt-billing.sh`](./firstboot-mt-billing.sh) to finish (panel on port 80).
3. Open `http://<device-ip>/` — panel login `admin` / `admin123`.
4. Console / SSH login: **`mtadmin` / `mtbilling`** (change immediately).

```bash
ssh mtadmin@<device-ip>
```

First-boot log on device: `/var/log/mt-billing-firstboot.log`.

### Orange Pi One notes

- 512 MB RAM — first-boot creates a 1G swapfile; expect a slow first install.
- Prefer a Class 10 / UHS microSD **≥ 16 GB**.
- Use the **`.img.xz`** file directly in Etcher (do not extract into a folder).
