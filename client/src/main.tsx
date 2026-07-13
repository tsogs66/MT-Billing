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

function applyViewportHeightVar() {
  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-vh', `${Math.max(1, height)}px`);
}

function initViewportTracking() {
  applyViewportHeightVar();
  const vv = window.visualViewport;
  const onResize = () => applyViewportHeightVar();
  window.addEventListener('resize', applyViewportHeightVar, { passive: true });
  window.addEventListener('orientationchange', applyViewportHeightVar, { passive: true });
  vv?.addEventListener('resize', onResize, { passive: true });
  return () => {
    window.removeEventListener('resize', applyViewportHeightVar);
    window.removeEventListener('orientationchange', applyViewportHeightVar);
    vv?.removeEventListener('resize', onResize);
  };
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

async function registerWebAppServiceWorker() {
  if (isNativeApp()) return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    /* service worker registration is best-effort */
  }
}

function Root() {
  const [ready, setReady] = useState(!needsServerSetup());

  useEffect(() => {
    const stopViewportTracking = initViewportTracking();
    void initNativeShell();
    void registerWebAppServiceWorker();
    return stopViewportTracking;
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
