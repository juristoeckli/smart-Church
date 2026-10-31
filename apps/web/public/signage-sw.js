const cacheName = 'smart-church-signage-shell-v4';
const shellPaths = ['/signage-display.html', '/signage-player.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shellPaths)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('smart-church-signage-shell-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !shellPaths.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (!response.ok) throw new Error('The player shell is unavailable.');
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(cacheName).then(cache => cache.put(url.pathname, copy)));
    }
    return response;
  }).catch(() => caches.open(cacheName).then(cache => cache.match(url.pathname)).then(response => response || Response.error())));
});
