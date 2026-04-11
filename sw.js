const CACHE_NAME = 'geeta-sync-v1';
const ASSETS_TO_CACHE = [
  './audio_sync.html',
  './gat_library/css/gat_audio_sync_style.css',
  './gat_library/js/gat_audio_sync_script.js',
  './gat_library/js/jquery-3.7.1.slim.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
