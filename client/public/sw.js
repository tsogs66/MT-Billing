/* MT-Billing service worker — installable web-app shell for Android/desktop.
 * Strategy:
 *   - Never touch /api, websockets or non-GET requests (always live).
 *   - Navigations: network-first, fall back to cached app shell when offline.
 *   - Hashed build assets (/assets/*): cache-first (they are immutable).
 *   - Same-origin static files (icons, manifest): stale-while-revalidate.
 */
const VERSION = 'v1';
const SHELL_CACHE = `mtb-shell-${VERSION}`;
const ASSET_CACHE = `mtb-assets-${VERSION}`;
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/logo.png', '/favicon-64.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Live data / sockets must never be served from cache.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket')) return;

  // SPA navigations → network-first, offline fallback to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  if (!sameOrigin) return;

  // Immutable hashed assets → cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            return res;
          })
      )
    );
    return;
  }

  // Other same-origin static files → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
