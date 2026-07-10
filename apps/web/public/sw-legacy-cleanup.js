// Imported by the Workbox-generated service worker (see vite.config.ts).
// Deletes the cache created by the previous hand-rolled sw.js so clients that
// installed it don't keep a few MB of dead storage around.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('chesser-v1'));
});
