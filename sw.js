// StockAnalysis Dashboard service worker
// Strategy:
//   - Static shell (HTML/CSS/JS): network-first w/ cache fallback so deploys
//     ship instantly but the app still opens offline.
//   - API responses: network-first, no cache (data must be fresh).
// Bump CACHE_VERSION any time the static shell changes shape.

const CACHE_VERSION = 'sa-v4.7';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const SHELL_FILES = [
    './',
    './index.html',
    './css/style.css?v=3.8',
    './js/api.js?v=3.8',
    './js/app.js?v=3.8',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_FILES).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k.startsWith('sa-') && !k.startsWith(CACHE_VERSION))
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Never cache API calls — data must be fresh. Network-only.
    if (url.hostname.includes('azurewebsites.net') ||
        url.pathname.startsWith('/api/')) {
        return;
    }

    // Same-origin static shell: network-first, cache fallback.
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req)
                .then(resp => {
                    if (resp && resp.status === 200) {
                        const clone = resp.clone();
                        caches.open(SHELL_CACHE).then(c => c.put(req, clone)).catch(() => {});
                    }
                    return resp;
                })
                .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
        );
    }
});
