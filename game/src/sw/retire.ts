import { retirePreview, type RetireHost } from '../platform/retireLogic';

/*
 * The worker left at the retired preview address, built to `next/sw.js` by vite/precache.ts. A device that ran the
 * preview's offline worker fetches this as that worker's update, and a page there registers it too: it takes over,
 * deletes the preview's caches, sends the preview's open pages to the game at the site root, and unregisters itself.
 * It has no fetch handler, so it never answers a request, and it touches no other storage and no other registration.
 */

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  const host: RetireHost = {
    claim: () => self.clients.claim(),
    cacheNames: () => caches.keys(),
    deleteCache: (name) => caches.delete(name),
    windows: () => self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
    unregister: () => self.registration.unregister(),
  };
  event.waitUntil(
    retirePreview(host, new URL(self.registration.scope)).then((problems) => {
      for (const problem of problems) console.warn(problem);
    }),
  );
});
