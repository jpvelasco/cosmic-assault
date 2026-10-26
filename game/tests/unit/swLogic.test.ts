import { describe, expect, it, vi } from 'vitest';
import { cacheFirst, isErrorPage, isStaleCache, NAVIGATION_TIMEOUT_MS, networkFirst, precacheName, shouldCache, shouldHandle } from '../../src/platform/swLogic';

const SCOPE = new URL('https://example.test/cosmic-assault/next/');
const at = (path: string) => new URL(path, SCOPE);

describe('precacheName', () => {
  it('prefixes the version', () => {
    expect(precacheName('abc123')).toBe('cosmic-assault-next-abc123');
  });
});

describe('isStaleCache', () => {
  const current = precacheName('new');

  it('is true for an older version of our cache', () => {
    expect(isStaleCache(precacheName('old'), current)).toBe(true);
  });

  it('is false for the current cache', () => {
    expect(isStaleCache(current, current)).toBe(false);
  });

  it('is false for a cache that is not ours', () => {
    expect(isStaleCache('workbox-precache-v2', current)).toBe(false);
    expect(isStaleCache('cosmic-assault-legacy', current)).toBe(false);
  });
});

describe('shouldHandle', () => {
  it('handles a GET for an asset under the scope', () => {
    expect(shouldHandle(at('/cosmic-assault/next/assets/x.js'), 'GET', SCOPE)).toBe(true);
    expect(shouldHandle(at('/cosmic-assault/next/'), 'GET', SCOPE)).toBe(true);
  });

  it('leaves the legacy site at the root alone', () => {
    expect(shouldHandle(at('/cosmic-assault/'), 'GET', SCOPE)).toBe(false);
    expect(shouldHandle(at('/cosmic-assault/index.html'), 'GET', SCOPE)).toBe(false);
    expect(shouldHandle(at('/cosmic-assault/next'), 'GET', SCOPE)).toBe(false);
    expect(shouldHandle(at('/cosmic-assault/next-other/x.js'), 'GET', SCOPE)).toBe(false);
  });

  it('leaves anything but GET alone', () => {
    expect(shouldHandle(at('/cosmic-assault/next/assets/x.js'), 'POST', SCOPE)).toBe(false);
    expect(shouldHandle(at('/cosmic-assault/next/assets/x.js'), 'HEAD', SCOPE)).toBe(false);
  });

  it('leaves another origin alone, even on the same path', () => {
    expect(shouldHandle(new URL('https://cdn.test/cosmic-assault/next/assets/x.js'), 'GET', SCOPE)).toBe(false);
    expect(shouldHandle(new URL('http://example.test/cosmic-assault/next/assets/x.js'), 'GET', SCOPE)).toBe(false);
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
