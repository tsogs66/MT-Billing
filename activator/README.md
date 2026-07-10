# MT-Billing License Activator (vendor tool)

Generates the license key that matches a customer's **Hardware ID** (shown in the
panel at **System Settings → License**). Keep this tool private — it contains the
signing secret used to produce valid keys.

There are two ways to use it on Windows.

## Option A — Standalone `.exe` (no Node needed on the customer/vendor PC)

Build the `.exe` once (on any machine with Node 18+ and internet):

```bash
cd activator
npm install
npm run build:win
```

This produces **`activator/dist/mt-billing-activator.exe`** — a single file you can
copy to any Windows machine.

Usage:

- **Double-click** `mt-billing-activator.exe` → a console opens, asks for the
  Hardware ID, prints the License Key, and waits for Enter.
- Or from Command Prompt / PowerShell:
  ```bat
  mt-billing-activator.exe 1A2B-3C4D-5E6F-7890
  ```

To also build Linux/macOS binaries: `npm run build:all` (outputs to `dist/`).

> Build uses [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg) (the maintained
> `pkg` fork). `pkg` can cross-compile a Windows `.exe` from Linux or macOS too.

## Option B — `activator.html` (zero install, runs by double-click)

If you can't build an `.exe`, just use **`activator.html`**:

1. Copy `activator.html` to the Windows machine.
2. Double-click it — it opens in the default browser and runs **fully offline**.
3. Paste the Hardware ID, click **Generate License Key**, copy the key.

Same algorithm and output as the `.exe`.

## Workflow

1. Customer opens **System Settings → License** and copies their **Hardware ID**.
2. You run the activator (`.exe` or `.html`) with that Hardware ID to get a **License Key**.
3. Customer pastes the key into the License page and clicks **Activate**.

The key is bound to that exact Hardware ID (HMAC-SHA256), so it only activates the
machine it was generated for.
