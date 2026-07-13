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

function registerServiceWorker() {
  // PWA install/offline shell for browser use on Android. The Capacitor app
  // ships its own local assets, so the SW is web-only, production-only.
  if (isNativeApp() || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  };
  // React mounts after the window load event on fast loads — register directly.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

async function initNativeShell() {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
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
    registerServiceWorker();
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
