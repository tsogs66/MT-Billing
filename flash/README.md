# Flash images (Raspberry Pi & Orange Pi)

Two **separate** disk images — one per board. Build on a Linux host, then flash with **Balena Etcher** or **Rufus**.

| Board | Build command | Output files |
|-------|---------------|--------------|
| **Raspberry Pi** 3/4/5 | `sudo bash scripts/build-rpi-img.sh` | `dist/flash/mt-billing-rpi-arm64.img` (+ `.img.xz`) |
| **Orange Pi** 5 | `sudo bash scripts/build-opi-img.sh` | `dist/flash/mt-billing-opi-arm64.img` (+ `.img.xz`) |

Build both:

```bash
sudo bash scripts/build-sbc-flash-image.sh --board all
```

See **[SYSTEM_REQUIREMENTS.md](../SYSTEM_REQUIREMENTS.md)** for hardware minimums.

On first boot the device runs [`firstboot-mt-billing.sh`](./firstboot-mt-billing.sh) once (needs internet), then serves the panel on port 80.
