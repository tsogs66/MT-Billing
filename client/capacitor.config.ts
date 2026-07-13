import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

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
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
