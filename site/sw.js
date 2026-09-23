/* lint.one — offline copy.
   The first visit saves every file the site is made of; after that each page
   is answered from that copy, so the tools open with no connection at all.
   build.mjs fills in FILES and VERSION. A deploy changes VERSION, which makes
   the browser install the new copy and drop the old one. */

const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = 'lint-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('lint-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Only the site's own files come from the copy. Anything else — the waitlist
   API, a format that does not exist yet — goes to the network as usual. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: req.mode === 'navigate' })
      .then((hit) => hit || fetch(req))
  );
});
