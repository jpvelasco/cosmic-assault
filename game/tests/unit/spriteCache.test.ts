import { describe, expect, it, vi } from 'vitest';
import { SpriteCache } from '../../src/render/spriteCache';

function makeCache(capacity: number) {
  const evicted: [string, number][] = [];
  const cache = new SpriteCache<number>(capacity, (key, value) => evicted.push([key, value]));
  return { cache, evicted };
}

describe('SpriteCache', () => {
  it('stores and returns values, and reports size', () => {
    const { cache } = makeCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('zzz')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('lists the keys it holds, which an eviction drops', () => {
    const { cache } = makeCache(2);
    expect(cache.keys()).toEqual([]);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.keys()).toEqual(['a', 'b']);
    cache.set('c', 3);
    expect(cache.keys()).toEqual(['b', 'c']);
  });

  it('evicts the least recently used entry through onEvict when over capacity', () => {
    const { cache, evicted } = makeCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(evicted).toEqual([['a', 1]]);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('counts the entries it evicts to stay within capacity, and only those: replacing, deleting and clearing are not evictions', () => {
    const { cache } = makeCache(2);
    expect(cache.evictions).toBe(0);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.delete('b');
    cache.set('b', 4);
    expect(cache.evictions).toBe(0);
    cache.set('c', 5);
    cache.set('d', 6);
    expect(cache.evictions).toBe(2);
    cache.clear();
    expect(cache.evictions).toBe(2);
  });

  it('get refreshes recency', () => {
    const { cache, evicted } = makeCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(evicted).toEqual([['b', 2]]);
    expect(cache.get('a')).toBe(1);
  });

  it('a hit only stamps the entry: it never deletes or re-inserts, so the map order stays put', () => {
    const { cache } = makeCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    const set = vi.spyOn(Map.prototype, 'set');
    const remove = vi.spyOn(Map.prototype, 'delete');
    for (let i = 0; i < 100; i++) cache.get(i % 2 === 0 ? 'a' : 'b');
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    set.mockRestore();
    remove.mockRestore();
  });

  it('replacing a key releases the old value and refreshes recency', () => {
    const { cache, evicted } = makeCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    expect(evicted).toEqual([['a', 1]]);
    cache.set('c', 3);
    expect(evicted).toEqual([['a', 1], ['b', 2]]);
    expect(cache.get('a')).toBe(10);
  });

  it('re-setting the identical value does not evict it', () => {
    const { cache, evicted } = makeCache(2);
    cache.set('a', 1);
    cache.set('a', 1);
    expect(evicted).toEqual([]);
    expect(cache.size).toBe(1);
  });

  it('delete releases one entry and ignores a missing key', () => {
    const { cache, evicted } = makeCache(2);
    cache.set('a', 1);
    cache.delete('a');
    cache.delete('nope');
    expect(evicted).toEqual([['a', 1]]);
    expect(cache.size).toBe(0);
  });

  it('clear evicts everything through onEvict', () => {
    const { cache, evicted } = makeCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(evicted).toEqual([['a', 1], ['b', 2]]);
    expect(cache.size).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects capacity %s with advice', (capacity) => {
    expect(() => new SpriteCache<number>(capacity, () => undefined)).toThrow(RangeError);
    expect(() => new SpriteCache<number>(capacity, () => undefined)).toThrow('pass a whole number of 1 or more');
  });

  it('works at capacity 1', () => {
    const { cache, evicted } = makeCache(1);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(evicted).toEqual([['a', 1]]);
    expect(cache.get('b')).toBe(2);
  });
});
