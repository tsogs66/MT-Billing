# Android app (Capacitor)

MT-Billing ships a **Capacitor** wrapper around the React client so you can build
an Android APK that talks to your existing panel over HTTPS.

App ID: `com.tsogs.mtbilling`  
App name: **MT-Billing**

## What you need on the build machine

- Node.js 20+
- Android Studio (Ladybug+ recommended) with Android SDK + a device/emulator
- JDK 17 or 21

This cloud environment may not include the full Android SDK — generate/sync here,
then open the project in Android Studio on your PC to produce the APK.

## One-time / every UI change

From the **repo root**:

```bash
npm install
npm run android:sync
npm run android:open
```

Or from `client/`:

```bash
npm run cap:android
```

That builds the Vite app into `client/dist`, copies it into
`client/android/`, then opens Android Studio.

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Debug APK path (typical):

`client/android/app/build/outputs/apk/debug/app-debug.apk`

## First launch on the phone

1. Install the APK.
2. Enter your **public panel URL** (same hostname you use in a browser), e.g.
   `https://billing.yourdomain.com`.
3. The app checks `/api/health`, then shows the normal login screen.

You can change the server later from the login screen (**Change server URL**).

### Optional: bake the server URL into the build

```bash
cd client
VITE_API_BASE=https://billing.yourdomain.com npm run cap:sync
```

Then the connect screen is skipped.

## Notes

- The app does **not** run the Node API on the phone — it is a remote client.
- Terminal WebSockets use `wss://` against the same host.
- Use a valid HTTPS certificate on the panel (Let’s Encrypt / Cloudflare).
- `cleartext: true` is enabled for LAN `http://` testing only; prefer HTTPS in production.
- Play Store release: create a keystore and use a release build variant in Android Studio.

## Project layout

| Path | Role |
|------|------|
| `client/capacitor.config.ts` | Capacitor app id / plugins |
| `client/android/` | Native Android Studio project |
| `client/android/README_ANDROID_STUDIO.md` | Quick Android Studio build steps |
| `client/src/config.ts` | API base URL (web vs native) |
| `client/src/pages/ServerSetup.tsx` | First-run panel URL screen |
