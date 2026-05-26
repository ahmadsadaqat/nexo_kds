const CACHE_NAME = 'nexo-kds-cache-v1';
const ASSETS = [
    '/kds',
    '/assets/frappe/js/lib/jquery/jquery.min.js',
    '/assets/nexo_kds/js/kds.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('fetch', (e) => {
    // network-first fallback to cache fallback policy for realtime apps
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
