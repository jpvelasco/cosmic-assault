import { cacheFirst, isEntryNavigation, isStaleCache, NAVIGATION_TIMEOUT_MS, networkFirst, precacheName, shouldHandle } from '../platform/swLogic';

/*
 * The offline worker, built to `sw.js` by vite/precache.ts. It is registered from beside index.html with the default
 * scope, so it only ever controls pages under the game's directory, never another project on the same host. Within
 * that scope it never answers for the retired preview address (`shouldHandle`), and its cached page answers only
 * navigations to the game's own address (`isEntryNavigation`): every other request goes to the network.
 */

declare const self: ServiceWorkerGlobalScope;
/** The built files kept for offline play, relative to this script; vite/precache.ts writes the literal in at build time. */
declare const __PRECACHE__: readonly string[];
/** The commit, or a hash of the built files; vite/precache.ts writes the literal in at build time. */
declare const __VERSION__: string;

const CACHE = precacheName(__VERSION__);
const scope = new URL(self.registration.scope);
const INDEX_URL = new URL('index.html', scope).href;
/**
 * Hosts may send `Vary: Origin` (Vite's preview server does), and a module script's request carries an `Origin`
 * header that the precache's requests lack, so honouring Vary would miss every precached script.
 */
const MATCH: MultiCacheQueryOptions = { cacheName: CACHE, ignoreVary: true };

async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  // `reload` skips the HTTP cache, so a fresh deploy never stores a stale page beside new assets.
  await cache.addAll(__PRECACHE__.map((path) => new Request(path, { cache: 'reload' })));
}

async function dropStaleCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => isStaleCache(name, CACHE)).map((name) => caches.delete(name)));
}

self.addEventListener('install', (event) => {
  // Assets are content-hashed and nothing loads lazily after start, so taking over at once is safe.
  event.waitUntil(Promise.all([self.skipWaiting(), precache()]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(dropStaleCaches().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (!shouldHandle(url, request.method, scope)) return;
  // DevTools can send these; fetch() throws on them outside same-origin mode, so the browser keeps them.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const navigation = request.mode === 'navigate';
  if (navigation && !isEntryNavigation(url, scope)) return;
  // A navigation asks the host whether the page changed (`no-cache`) even while the browser's HTTP cache would still
  // call its copy fresh (GitHub Pages allows ten minutes), so the page never comes from an older deploy than the worker.
  event.respondWith(
    navigation
      ? networkFirst(fetch(request, { cache: 'no-cache' }), () => caches.match(INDEX_URL, MATCH), NAVIGATION_TIMEOUT_MS)
      : cacheFirst(
          () => caches.match(request, MATCH),
          () => fetch(request),
          (copy) => {
            // A full or evicted cache only means the next visit downloads this again, so a failed write is dropped.
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined));
          },
        ),
  );
});
