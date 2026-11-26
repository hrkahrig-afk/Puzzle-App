// Offline support.
// Network-first: when online, always use the latest files (so an update can never
// mix old and new code); fall back to the cached copy only when offline.
const VERSION = 'v30';
const CACHE = 'puzzle-box-' + VERSION;
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/core.js', 'js/wordle.js', 'js/sudoku.js', 'js/sudoku-gen.js',
  'js/crossword.js', 'js/crossword-gen.js', 'js/crossword-worker.js', 'js/keystone.js', 'js/keystone-engine.js',
  'js/data/words5.js', 'js/data/clues.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // 'reload' bypasses the browser's HTTP cache so the new cache holds the new files
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(ASSETS.map((a) => fetch(new Request(a, { cache: 'reload' })).then((r) => r.ok && c.put(a, r)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || Response.error();
    }
  })());
});
