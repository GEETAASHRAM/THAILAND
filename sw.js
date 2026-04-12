const CACHE_NAME = 'geeta-app-v7';

const APP_SHELL = [
  './',
  './index.html',
  './audio_sync.html',
  './manifest.json',
  './gat_library/css/gat_audio_sync_style.css',
  './gat_library/js/app.js',
  './gat_library/js/gat_audio_sync_script.js',
  './gat_library/js/json_worker.js',
  './data/geeta_complete.json',
  './data/geeta_twelfth_chapter.json'
];

// ---------------------------------------------------------
// Install
// ---------------------------------------------------------
self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(error => {
      console.warn('SW install cache warning:', error);
    })
  );
});

// ---------------------------------------------------------
// Activate
// ---------------------------------------------------------
self.addEventListener('activate', event => {
  self.clients.claim();

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
          return Promise.resolve();
        })
      )
    )
  );
});

// ---------------------------------------------------------
// Fetch strategy
// ---------------------------------------------------------
self.addEventListener('fetch', event => {
  const req = event.request;

  // Skip non-GET requests
  if (req.method !== 'GET') return;

  // =======================================================
  // FIX: prevent chrome-extension / unsupported scheme cache errors
  // =======================================================
  if (!req.url.startsWith('http')) {
    event.respondWith(fetch(req));
    return;
  }

  const url = new URL(req.url);

  // Never cache audio or range requests
  const isAudio =
    /\.(mp3|wav|m4a|aac|ogg)$/i.test(url.pathname) ||
    req.destination === 'audio' ||
    req.headers.has('range');

  if (isAudio) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response('', { status: 504, statusText: 'Audio fetch failed' });
      })
    );
    return;
  }

  // Network-first for documents and JSON
  if (req.destination === 'document' || url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
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
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
