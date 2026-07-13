import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tsogs.mtbilling',
  appName: 'MT-Billing',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Allow cleartext for LAN http:// testing. Use HTTPS in production.
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1200,
      backgroundColor: '#0f172a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#00000000',
      overlaysWebView: true,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: true,
    // Edge-to-edge: the web shell handles status bar / nav bar insets via CSS
    // env(safe-area-inset-*) variables.
    initialFocus: false,
    captureInput: false,
  },
};

export default config;
