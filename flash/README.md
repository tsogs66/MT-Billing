# Flash images (Raspberry Pi & Orange Pi)

Build a **single `.img.xz` file** for your board, then flash it with **Balena Etcher** or **Rufus**.

| Board | Build command | Output |
|-------|---------------|--------|
| Raspberry Pi 3/4/5 | `sudo bash scripts/build-sbc-flash-image.sh --board rpi` | `dist/flash/mt-billing-rpi-arm64.img.xz` |
| Orange Pi 5 | `sudo bash scripts/build-sbc-flash-image.sh --board opi` | `dist/flash/mt-billing-opi-arm64.img.xz` |

See **[SYSTEM_REQUIREMENTS.md](../SYSTEM_REQUIREMENTS.md)** for hardware minimums and flash steps.

On first boot the device runs [`firstboot-mt-billing.sh`](./firstboot-mt-billing.sh) once (needs internet), then serves the panel on port 80.
