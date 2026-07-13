import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tsogs.mtbilling',
  appName: 'MT-Billing',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // cleartext only needed if testing against http:// LAN IPs
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0f172a',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
    Keyboard: {
      // Resize the web view (not just the body) so inputs stay visible above
      // the on-screen keyboard on Android.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: true,
    // Let the WebView grant getUserMedia (QR / receipt scanner) once the
    // Android CAMERA runtime permission is granted.
    captureInput: true,
  },
};

export default config;
