/* lint.one — offline copy.
   The first visit saves every file the site is made of; after that each page
   is answered from that copy, so the tools open with no connection at all.
   build.mjs fills in FILES and VERSION. A deploy changes VERSION, which makes
   the browser install the new copy and drop the old one. */

const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = 'lint-' + VERSION;

/* Files too large to give every visitor — DuckDB, which the Parquet tool
   loads only for sorting and SQL. Each is saved the first time it is
   fetched, in a cache of its own that outlives deploys, since its URLs
   carry its version. Entries no longer listed are dropped on activate. */
const LAZY = __LAZY__;
const LAZY_CACHE = 'lint.lazy';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('lint-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => caches.open(LAZY_CACHE))
      .then((c) => c.keys().then((reqs) => Promise.all(reqs
        .filter((r) => !LAZY.includes(new URL(r.url).pathname))
        .map((r) => c.delete(r)))))
      .then(() => self.clients.claim())
  );
});

/* Only the site's own files come from the copy. Anything else — the waitlist
   API, a format that does not exist yet — goes to the network as usual. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (LAZY.includes(url.pathname)) {
    e.respondWith(caches.open(LAZY_CACHE).then((c) => c.match(req).then((hit) => hit ||
      fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      }))));
    return;
  }
  e.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: req.mode === 'navigate' })
      .then((hit) => hit || fetch(req))
  );
});
