const CACHE_NAME = 'geeta-app-v3';

const ASSETS_TO_CACHE = [
  './index.html',
  './styles.css',
  './app.js',
  './audio_sync.html',
  './gat_library/css/gat_audio_sync_style.css',
  './gat_library/js/gat_audio_sync_script.js',
  './data/geeta_complete.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)));
});

self.addEventListener('activate', event => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => { if (key !== CACHE_NAME) return caches.delete(key); })
    ))
  );
});

// Advanced Fetch: Cache Audio, but serve Range Requests properly if possible
self.addEventListener('fetch', event => {
  const req = event.request;
  
  // Audio files caching strategy (Cache First, then Network)
  if (req.url.endsWith('.mp3')) {
      event.respondWith(
          caches.match(req).then(cachedRes => {
              if (cachedRes) return cachedRes;
              return fetch(req).then(fetchRes => {
                  // Only cache if successful and NOT a partial response (206)
                  if (fetchRes.status === 200) {
                      const resClone = fetchRes.clone();
                      caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
                  }
                  return fetchRes;
              });
          })
      );
      return;
  }

  // Standard Assets (Network First, fallback to Cache)
  event.respondWith(
    fetch(req)
      .then(res => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(req, res.clone()); return res;
        });
      })
      .catch(() => caches.match(req))
  );
});
