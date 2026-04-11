const CACHE_NAME = 'geeta-sync-v2'; // bump this every deploy

const ASSETS_TO_CACHE = [
  './audio_sync.html',
  './gat_library/css/gat_audio_sync_style.css',
  './gat_library/js/gat_audio_sync_script.js',
  './gat_library/js/jquery-3.7.1.slim.min.js'
];

// INSTALL
self.addEventListener('install', event => {
  self.skipWaiting(); // activate immediately

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// ACTIVATE
self.addEventListener('activate', event => {
  self.clients.claim(); // take control immediately

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key); // delete old caches
          }
        })
      )
    )
  );
});

// FETCH (better strategy)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // update cache in background
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, response.clone());
          return response;
        });
      })
      .catch(() => caches.match(event.request)) // fallback offline
  );
});
