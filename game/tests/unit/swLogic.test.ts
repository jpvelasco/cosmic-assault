import { describe, expect, it, vi } from 'vitest';
import {
  CACHE_PREFIX,
  cacheFirst,
  isEntryNavigation,
  isErrorPage,
  isStaleCache,
  NAVIGATION_TIMEOUT_MS,
  networkFirst,
  precacheName,
  PREVIEW_CACHE_PREFIX,
  RETIRED_PREVIEW_DIR,
  shouldCache,
  shouldHandle,
} from '../../src/platform/swLogic';

const SCOPES = [new URL('https://example.test/cosmic-assault/'), new URL('https://example.test/')];

describe('precacheName', () => {
  it('prefixes the version with the game\'s own cache prefix', () => {
    expect(precacheName('abc123')).toBe('cosmic-assault-v2-abc123');
    expect(precacheName('abc123').startsWith(CACHE_PREFIX)).toBe(true);
  });

  it('never matches the retired preview\'s caches, which are deleted by name', () => {
    expect(PREVIEW_CACHE_PREFIX).toBe('cosmic-assault-next-');
    expect(precacheName('abc123').startsWith(PREVIEW_CACHE_PREFIX)).toBe(false);
  });
});

describe('isStaleCache', () => {
  const current = precacheName('new');

  it('is true for an older version of our cache', () => {
    expect(isStaleCache(precacheName('old'), current)).toBe(true);
  });

  it('is true for any cache the retired preview left', () => {
    expect(isStaleCache('cosmic-assault-next-old', current)).toBe(true);
    expect(isStaleCache('cosmic-assault-next-new', current)).toBe(true);
  });

  it('is false for the current cache', () => {
    expect(isStaleCache(current, current)).toBe(false);
  });

  it('is false for a cache that is not ours, even one whose name holds our words', () => {
    expect(isStaleCache('workbox-precache-v2', current)).toBe(false);
    expect(isStaleCache('cosmic-assault-legacy', current)).toBe(false);
    expect(isStaleCache('cosmic-assault-v2', current)).toBe(false);
    expect(isStaleCache('cosmic-assault-next', current)).toBe(false);
  });
});

describe.each(SCOPES.map((scope) => [scope.href, scope] as const))('with the scope %s', (_, scope) => {
  const at = (path: string) => new URL(path, scope);

  describe('shouldHandle', () => {
    it('handles a GET for the game and its assets', () => {
      expect(shouldHandle(at('./'), 'GET', scope)).toBe(true);
      expect(shouldHandle(at('index.html?seed=7'), 'GET', scope)).toBe(true);
      expect(shouldHandle(at('assets/x.js'), 'GET', scope)).toBe(true);
    });

    it('leaves the retired preview address to the network, with or without a slash', () => {
      expect(shouldHandle(at(RETIRED_PREVIEW_DIR), 'GET', scope)).toBe(false);
      expect(shouldHandle(at('next'), 'GET', scope)).toBe(false);
      expect(shouldHandle(at('next?from=old-link'), 'GET', scope)).toBe(false);
      expect(shouldHandle(at('next/'), 'GET', scope)).toBe(false);
      expect(shouldHandle(at('next/index.html'), 'GET', scope)).toBe(false);
      expect(shouldHandle(at('next/sw.js'), 'GET', scope)).toBe(false);
      expect(shouldHandle(at('next/assets/x.js'), 'GET', scope)).toBe(false);
    });

    it('still handles a file whose name only starts with the preview\'s', () => {
      expect(shouldHandle(at('nextlevel.png'), 'GET', scope)).toBe(true);
      expect(shouldHandle(at('next-other/x.js'), 'GET', scope)).toBe(true);
      expect(shouldHandle(at('assets/next/x.js'), 'GET', scope)).toBe(true);
    });

    it('leaves anything but GET alone', () => {
      expect(shouldHandle(at('assets/x.js'), 'POST', scope)).toBe(false);
      expect(shouldHandle(at('assets/x.js'), 'HEAD', scope)).toBe(false);
    });

    it('leaves another origin alone, even on the same path', () => {
      expect(shouldHandle(new URL(`https://cdn.test${scope.pathname}assets/x.js`), 'GET', scope)).toBe(false);
      expect(shouldHandle(new URL(`http://example.test${scope.pathname}assets/x.js`), 'GET', scope)).toBe(false);
    });
  });

  describe('isEntryNavigation', () => {
    it('is true for the game\'s own address, whatever the query', () => {
      expect(isEntryNavigation(at('./'), scope)).toBe(true);
      expect(isEntryNavigation(at('index.html'), scope)).toBe(true);
      expect(isEntryNavigation(at('./?seed=7&lives=1'), scope)).toBe(true);
      expect(isEntryNavigation(at('index.html?galaxy=2-1#top'), scope)).toBe(true);
    });

    it('is false for any other page, so a missing one stays the host\'s 404', () => {
      expect(isEntryNavigation(at('missing/'), scope)).toBe(false);
      expect(isEntryNavigation(at('missing.html'), scope)).toBe(false);
      expect(isEntryNavigation(at('sw.js'), scope)).toBe(false);
      expect(isEntryNavigation(at('index.htm'), scope)).toBe(false);
      expect(isEntryNavigation(at('next/'), scope)).toBe(false);
      expect(isEntryNavigation(at('next/index.html'), scope)).toBe(false);
    });
  });
});

describe('shouldCache', () => {
  it('caches a whole same-origin 200', () => {
    expect(shouldCache({ status: 200, type: 'basic' })).toBe(true);
  });

  it('never caches an opaque, cross-origin or failed response', () => {
    expect(shouldCache({ status: 0, type: 'opaque' })).toBe(false);
    expect(shouldCache({ status: 200, type: 'cors' })).toBe(false);
    expect(shouldCache({ status: 404, type: 'basic' })).toBe(false);
    expect(shouldCache({ status: 500, type: 'basic' })).toBe(false);
  });

  it('never caches a partial response, which the Cache API rejects', () => {
    expect(shouldCache({ status: 206, type: 'basic' })).toBe(false);
  });
});

describe('isErrorPage', () => {
  it.each([400, 404, 410, 500, 502, 503])('is true for a %i, which the cached game serves better', (status) => {
    expect(isErrorPage({ status })).toBe(true);
  });

  it.each([200, 204, 304, 0])('is false for a %i: a page, or a redirect the browser follows itself', (status) => {
    expect(isErrorPage({ status })).toBe(false);
  });
});

describe('networkFirst', () => {
  const fresh = new Response('fresh');
  const cached = new Response('cached');
  const never = () => new Promise<Response>(() => undefined);

  it('waits a few seconds at most', () => {
    expect(NAVIGATION_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(NAVIGATION_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it('uses the network when it answers with the page', async () => {
    const fallback = vi.fn(() => Promise.resolve(cached));
    expect(await networkFirst(Promise.resolve(fresh), fallback, 1000)).toBe(fresh);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([404, 500, 503])('falls back to the cache when the network answers %i, as when offline', async (status) => {
    expect(await networkFirst(Promise.resolve(new Response('error', { status })), () => Promise.resolve(cached), 1000)).toBe(cached);
  });

  it('passes an error page on when nothing is cached', async () => {
    const notFound = new Response('missing', { status: 404 });
    expect(await networkFirst(Promise.resolve(notFound), () => Promise.resolve(undefined), 1000)).toBe(notFound);
  });

  it('falls back to the cache when the network fails', async () => {
    expect(await networkFirst(Promise.reject(new TypeError('offline')), () => Promise.resolve(cached), 1000)).toBe(cached);
  });

  it('falls back to the cache when the network is too slow', async () => {
    vi.useFakeTimers();
    try {
      const result = networkFirst(never(), () => Promise.resolve(cached), 3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await result).toBe(cached);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting for a slow network when nothing is cached', async () => {
    vi.useFakeTimers();
    try {
      let answer: (response: Response) => void = () => undefined;
      const slow = new Promise<Response>((resolve) => (answer = resolve));
      const result = networkFirst(slow, () => Promise.resolve(undefined), 3000);
      await vi.advanceTimersByTimeAsync(5000);
      answer(fresh);
      expect(await result).toBe(fresh);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the network failure on when nothing is cached', async () => {
    const failure = new TypeError('offline');
    await expect(networkFirst(Promise.reject(failure), () => Promise.resolve(undefined), 1000)).rejects.toBe(failure);
  });
});

describe('cacheFirst', () => {
  /** A Response as a browser types a same-origin one; Node's own are typed 'default'. */
  const basic = (body: string, status = 200) => Object.defineProperty(new Response(body, { status }), 'type', { value: 'basic' });
  const cached = new Response('cached');

  it('answers from the cache without touching the network', async () => {
    const network = vi.fn(() => Promise.resolve(basic('fresh')));
    expect(await cacheFirst(() => Promise.resolve(cached), network, vi.fn())).toBe(cached);
    expect(network).not.toHaveBeenCalled();
  });

  it('fetches a miss and stores a copy of a whole success', async () => {
    const fresh = basic('fresh');
    const store = vi.fn();
    expect(await cacheFirst(() => Promise.resolve(undefined), () => Promise.resolve(fresh), store)).toBe(fresh);
    expect(store).toHaveBeenCalledOnce();
    const [copy] = store.mock.calls[0] as [Response];
    expect(copy).not.toBe(fresh);
    expect(await copy.text()).toBe('fresh');
  });

  it('serves but never stores a response it must not cache', async () => {
    const store = vi.fn();
    const missing = basic('missing', 404);
    expect(await cacheFirst(() => Promise.resolve(undefined), () => Promise.resolve(missing), store)).toBe(missing);
    expect(store).not.toHaveBeenCalled();
  });

  it('falls through to the network when the cache cannot be read', async () => {
    const fresh = basic('fresh');
    expect(await cacheFirst(() => Promise.reject(new DOMException('read failed', 'UnknownError')), () => Promise.resolve(fresh), vi.fn())).toBe(fresh);
  });
});
