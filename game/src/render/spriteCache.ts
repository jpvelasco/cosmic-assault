interface Entry<V> {
  readonly value: V;
  /** The use clock when this entry was last set or read; the lowest is the least recently used. */
  used: number;
}

/**
 * A bounded least-recently-used cache for pre-rendered sprites. Every value that leaves
 * the cache (evicted, replaced, deleted or cleared) goes through `onEvict` so the owner
 * can release it, for example by shrinking a canvas.
 *
 * A hit only bumps the entry's use stamp, so the hot path never reorders the map; finding
 * the oldest entry costs a scan, but only when an insert overflows the capacity.
 */
export class SpriteCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private clock = 0;

  constructor(
    private readonly capacity: number,
    private readonly onEvict: (key: string, value: V) => void,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`SpriteCache needs a capacity of at least 1 (got ${String(capacity)}); pass a whole number of 1 or more`);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    entry.used = ++this.clock;
    return entry.value;
  }

  set(key: string, value: V): void {
    const previous = this.entries.get(key);
    this.entries.set(key, { value, used: ++this.clock });
    if (previous !== undefined && previous.value !== value) {
      this.onEvict(key, previous.value);
    }
    if (this.entries.size > this.capacity) {
      this.delete(this.oldestKey());
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.entries.delete(key);
      this.onEvict(key, entry.value);
    }
  }

  clear(): void {
    for (const [key, { value }] of [...this.entries]) {
      this.entries.delete(key);
      this.onEvict(key, value);
    }
  }

  private oldestKey(): string {
    let oldest = '';
    let stamp = Number.POSITIVE_INFINITY;
    for (const [key, { used }] of this.entries) {
      if (used < stamp) {
        stamp = used;
        oldest = key;
      }
    }
    return oldest;
  }
}
