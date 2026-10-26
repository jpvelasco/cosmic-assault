/**
 * The service worker's decisions, kept free of worker globals so they run under Vitest. `src/sw/worker.ts` is the
 * only caller in the app; it bundles this file into `sw.js`.
 */

const CACHE_PREFIX = 'cosmic-assault-next-';

/** How long a navigation waits for the network before the cached page is served, so a captive or slow network never hangs the player. */
export const NAVIGATION_TIMEOUT_MS = 3000;

export function precacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/** True only for an older cache of ours: another app's cache on this origin is never touched. */
export function isStaleCache(name: string, current: string): boolean {
  return name.startsWith(CACHE_PREFIX) && name !== current;
}

/** GETs inside the worker's scope only; the legacy site at the root and other origins pass straight through. */
export function shouldHandle(url: URL, method: string, scope: URL): boolean {
  return method === 'GET' && url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

/** Only whole, same-origin successes are stored: never an opaque, failed or partial (206) response. */
export function shouldCache(response: Pick<Response, 'status' | 'type'>): boolean {
  return response.status === 200 && response.type === 'basic';
}

/**
 * The network's answer, whatever its status. If the network fails or takes longer than `timeoutMs`, the cached copy
 * from `fallback` instead; with nothing cached, the network's eventual answer or failure.
 */
export async function networkFirst(
  network: Promise<Response>,
  fallback: () => Promise<Response | undefined>,
  timeoutMs: number,
): Promise<Response> {
  let cancelTimer = (): void => undefined;
  const timedOut = new Promise<undefined>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    cancelTimer = () => {
      clearTimeout(timer);
    };
  });
  try {
    const first = await Promise.race([network, timedOut]);
    if (first !== undefined) return first;
  } catch {
    // Offline or refused: the cache answers below.
  } finally {
    cancelTimer();
  }
  return (await fallback()) ?? network;
}

/**
 * The cached copy if there is one, else the network's answer, of which a copy goes to `store` when `shouldCache`
 * allows. A cache that cannot be read counts as a miss, so a storage fault never fails a request the network can serve.
 */
export async function cacheFirst(
  cached: () => Promise<Response | undefined>,
  network: () => Promise<Response>,
  store: (copy: Response) => void,
): Promise<Response> {
  const hit = await cached().catch(() => undefined);
  if (hit) return hit;
  const response = await network();
  if (shouldCache(response)) store(response.clone());
  return response;
}
