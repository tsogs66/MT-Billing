/**
 * Capacitor native shell behaviors for Android/iOS WebView builds.
 */
import { isNativeApp } from '../config';

let sidebarOpen = false;
let setSidebarOpenFn: ((open: boolean) => void) | null = null;

/** Layout registers sidebar state so the hardware back button can close the drawer. */
export function registerSidebarControl(open: boolean, setter: (v: boolean) => void) {
  sidebarOpen = open;
  setSidebarOpenFn = setter;
}

export function initNativeShell() {
  if (!isNativeApp()) return;

  document.documentElement.classList.add('native-app');

  void initKeyboard();
  void initBackButton();
  void initStatusBar();
}

async function initKeyboard() {
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    Keyboard.addListener('keyboardWillShow', () => {
      document.documentElement.classList.add('keyboard-open');
    });
    Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.classList.remove('keyboard-open');
    });
  } catch {
    /* optional plugin */
  }
}

async function initStatusBar() {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0f172a' });
  } catch {
    /* optional plugin */
  }
}

async function initBackButton() {
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      if (sidebarOpen && setSidebarOpenFn) {
        setSidebarOpenFn(false);
        return;
      }
      if (canGoBack && window.history.length > 1) {
        window.history.back();
        return;
      }
      void App.minimizeApp();
    });
  } catch {
    /* optional plugin */
  }
}
