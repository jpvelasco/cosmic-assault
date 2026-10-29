/**
 * The service worker's decisions, kept free of worker globals so they run under Vitest. `src/sw/worker.ts` is the
 * only caller in the app; it bundles this file into `sw.js`.
 */

/** The game's caches: this prefix and the build's version. */
export const CACHE_PREFIX = 'cosmic-assault-v2-';
/**
 * The caches of the worker that served the preview address, left on devices that ran it. The name is frozen: it is
 * what those devices hold.
 */
export const PREVIEW_CACHE_PREFIX = 'cosmic-assault-next-';
/** The retired preview address, a directory under the game's: the worker never answers for it. */
export const RETIRED_PREVIEW_DIR = 'next';

/** How long a navigation waits for the network before the cached page is served, so a captive or slow network never hangs the player. */
export const NAVIGATION_TIMEOUT_MS = 3000;

export function precacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/** True only for an older cache of ours or one the preview left: another app's cache on this origin is never touched. */
export function isStaleCache(name: string, current: string): boolean {
  return (name.startsWith(CACHE_PREFIX) && name !== current) || name.startsWith(PREVIEW_CACHE_PREFIX);
}

/**
 * GETs inside the worker's scope only, bar the retired preview address under it: other projects on this host, other
 * origins and anything under `next/` pass straight through to the network.
 */
export function shouldHandle(url: URL, method: string, scope: URL): boolean {
  if (method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false;
  const path = url.pathname.slice(scope.pathname.length);
  return path !== RETIRED_PREVIEW_DIR && !path.startsWith(`${RETIRED_PREVIEW_DIR}/`);
}

/**
 * The game's own address (the scope's directory or its index.html, whatever the query): the only navigations the cached
 * page may answer, so any other page in scope keeps the host's answer, a 404 included.
 */
export function isEntryNavigation(url: URL, scope: URL): boolean {
  return url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`;
}

/** Only whole, same-origin successes are stored: never an opaque, failed or partial (206) response. */
export function shouldCache(response: Pick<Response, 'status' | 'type'>): boolean {
  return response.status === 200 && response.type === 'basic';
}

/** A 4xx or 5xx answer, such as a host outage or a removed page, which the cached game serves better. */
export function isErrorPage(response: Pick<Response, 'status'>): boolean {
  return response.status >= 400;
}

/**
 * The network's answer. If the network fails, takes longer than `timeoutMs` or answers with an error page, the cached
 * copy from `fallback` instead; with nothing cached, the network's eventual answer or failure.
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
  let answer: Response | undefined;
  try {
    answer = await Promise.race([network, timedOut]);
    if (answer !== undefined && !isErrorPage(answer)) return answer;
  } catch {
    // Offline or refused: the cache answers below.
  } finally {
    cancelTimer();
  }
  return (await fallback()) ?? answer ?? network;
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
