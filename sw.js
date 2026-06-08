/* MotoMaintain service worker.
 *
 * Strategy:
 *  - Navigations / HTML  -> network-first: always fetch the freshest index.html
 *    when online (so new deploys show up automatically on each launch), fall
 *    back to cache when offline.
 *  - Same-origin static assets (icons, manifest) -> cache-first.
 *  - Cross-origin requests (Appwrite API, Google Fonts) -> untouched (network).
 *
 * Bump VERSION whenever you want every client to force-refresh its cache.
 */
const VERSION = 'v2026-06-08-122345';
const CACHE   = 'motomaintain-' + VERSION;
const ASSETS  = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})            // don't fail install if an asset is unavailable
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // leave API / fonts to the network

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first: freshest HTML when online, cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Cache-first for static same-origin assets.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
    )
  );
});
