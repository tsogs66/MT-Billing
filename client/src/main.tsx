import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { RouterProvider } from './context/RouterContext';
import { CompanyProvider } from './context/CompanyContext';
import { ThemeProvider } from './context/ThemeContext';
import ServerSetup from './pages/ServerSetup';
import { isNativeApp, needsServerSetup } from './config';
import 'leaflet/dist/leaflet.css';
import './index.css';

async function initNativeShell() {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0f172a' });
  } catch {
    /* optional plugin */
  }
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack || window.history.length > 1) {
        window.history.back();
        return;
      }
      void App.exitApp();
    });
  } catch {
    /* optional plugin */
  }
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.addListener('keyboardWillShow', (info) => {
      document.documentElement.classList.add('keyboard-open');
      document.documentElement.style.setProperty('--keyboard-offset', `${info.keyboardHeight || 0}px`);
    });
    await Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.classList.remove('keyboard-open');
      document.documentElement.style.setProperty('--keyboard-offset', '0px');
    });
  } catch {
    /* optional plugin */
  }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    /* optional plugin */
  }
}

function Root() {
  const [ready, setReady] = useState(!needsServerSetup());

  useEffect(() => {
    void initNativeShell();
  }, []);

  if (!ready) {
    return <ServerSetup onReady={() => setReady(true)} />;
  }

  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CompanyProvider>
            <RouterProvider>
              <App />
            </RouterProvider>
          </CompanyProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
