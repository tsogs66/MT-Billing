# Flash images (Raspberry Pi & Orange Pi)

Two **separate** disk images — one per board. Download from
[GitHub Releases](https://github.com/tsogs66/MT-Billing/releases/tag/sbc-flash-images)
or build locally, then flash with **Balena Etcher** or **Rufus**.

| Board | Download / build | Output files |
|-------|------------------|--------------|
| **Raspberry Pi** 3/4/5 | [release](https://github.com/tsogs66/MT-Billing/releases/tag/sbc-flash-images) or `sudo bash scripts/build-rpi-img.sh` | `mt-billing-rpi-arm64.img` (+ `.img.xz`) |
| **Orange Pi** 5 | [release](https://github.com/tsogs66/MT-Billing/releases/tag/sbc-flash-images) or `sudo bash scripts/build-opi-img.sh` | `mt-billing-opi-arm64.img` (+ `.img.xz`) |

Build both locally:

```bash
sudo bash scripts/build-sbc-flash-image.sh --board all
```

See **[SYSTEM_REQUIREMENTS.md](../SYSTEM_REQUIREMENTS.md)** for hardware minimums.

On first boot the device runs [`firstboot-mt-billing.sh`](./firstboot-mt-billing.sh) once (needs internet), then serves the panel on port 80.
