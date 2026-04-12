const CACHE_NAME = 'geeta-app-v4';

const APP_SHELL = [
  './',
  './index.html',
  './audio_sync.html',
  './manifest.json',
  './gat_library/css/gat_audio_sync_style.css',
  './gat_library/js/app.js',
  './gat_library/js/gat_audio_sync_script.js',
  './data/geeta_complete.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', event => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache audio or range requests
  const isAudio =
    /\.(mp3|wav|m4a|aac|ogg)$/i.test(url.pathname) ||
    req.destination === 'audio' ||
    req.headers.has('range');

  if (isAudio) {
    event.respondWith(fetch(req));
    return;
  }

  // Network-first for JSON
  if (req.destination === 'document' || url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Stale-while-revalidate for CSS/JS/images
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
