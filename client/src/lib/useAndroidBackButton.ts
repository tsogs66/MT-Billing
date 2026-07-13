import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNativeApp } from '../config';

/**
 * Wires the Android hardware / gesture back button to in-app navigation.
 * - Anywhere other than the home route, go back one step in history.
 * - On the home route (or with no history), minimise the app instead of
 *   leaving a blank WebView. No-op on the web build.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('backButton', ({ canGoBack }) => {
          const atRoot = location.pathname === '/' || location.pathname === '/login';
          if (!atRoot && (canGoBack || window.history.length > 1)) {
            navigate(-1);
          } else {
            void App.minimizeApp?.();
          }
        });
        if (cancelled) {
          void handle.remove();
        } else {
          remove = () => void handle.remove();
        }
      } catch {
        /* @capacitor/app unavailable (pure web) */
      }
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [navigate, location.pathname]);
}
