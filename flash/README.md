# Flash images (Raspberry Pi, Orange Pi & PC)

Three **separate** disk images — one per platform. Download from the
[flash images release](https://github.com/tsogs66/MT-Billing/releases/tag/sbc-flash-images)
or build locally, then flash with **Balena Etcher** or **Rufus** (DD Image mode).

| Platform | Build command | Output files |
|----------|---------------|--------------|
| **Raspberry Pi** 3/4/5 | `sudo bash scripts/build-rpi-img.sh` | `mt-billing-rpi-arm64.img` (+ `.img.xz`) |
| **Orange Pi** 5 | `sudo bash scripts/build-opi-img.sh` | `mt-billing-opi-arm64.img` (+ `.img.xz`) |
| **PC** (UEFI amd64) | `sudo bash scripts/build-pc-img.sh` | `mt-billing-pc-amd64.img` (+ `.img.xz`) |

Build all three:

```bash
sudo bash scripts/build-all-flash-images.sh
# or: sudo bash scripts/build-sbc-flash-image.sh --board all
```

Host build deps: `curl`, `xz`, `losetup`, `python3`, and for PC images `qemu-utils` (`qemu-img`).

See **[SYSTEM_REQUIREMENTS.md](../SYSTEM_REQUIREMENTS.md)** for hardware minimums.

## After flashing

1. Boot the device with Ethernet (recommended). First boot needs internet.
2. Wait for [`firstboot-mt-billing.sh`](./firstboot-mt-billing.sh) to finish (panel on port 80).
3. Open `http://<device-ip>/` — panel login `admin` / `admin123`.
4. **PC only:** console SSH user from the cloud seed is `mtadmin` / `mtbilling` (change immediately).

First-boot log on device: `/var/log/mt-billing-firstboot.log`.
