import { isStaleCache, NAVIGATION_TIMEOUT_MS, networkFirst, precacheName, shouldCache, shouldHandle } from '../platform/swLogic';

/*
 * The offline worker, built to `sw.js` by vite/precache.ts. It is registered from the preview directory with the
 * default scope, so it only ever controls pages under that directory, never the legacy site above it.
 */

declare const self: ServiceWorkerGlobalScope;
/** Every built file, relative to this script; vite/precache.ts writes the literal in at build time. */
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

async function cacheFirst(event: FetchEvent): Promise<Response> {
  const cached = await caches.match(event.request, MATCH);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (shouldCache(response)) {
    const copy = response.clone();
    // A full or evicted cache only means the next visit downloads this again.
    event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => undefined));
  }
  return response;
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
  if (!shouldHandle(new URL(request.url), request.method, scope)) return;
  event.respondWith(
    request.mode === 'navigate'
      ? networkFirst(fetch(request), () => caches.match(INDEX_URL, MATCH), NAVIGATION_TIMEOUT_MS)
      : cacheFirst(event),
  );
});
