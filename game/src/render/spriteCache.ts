/**
 * A bounded least-recently-used cache for pre-rendered sprites. Every value that leaves
 * the cache (evicted, replaced, deleted or cleared) goes through `onEvict` so the owner
 * can release it, for example by shrinking a canvas.
 */
export class SpriteCache<V> {
  private readonly entries = new Map<string, V>();

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
    const value = this.entries.get(key);
    if (value !== undefined) {
      // Map iterates in insertion order, so re-inserting marks the key most recent.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    const previous = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    if (previous !== undefined && previous !== value) {
      this.onEvict(key, previous);
    }
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.entries().next();
      if (!oldest.done) {
        this.delete(oldest.value[0]);
      }
    }
  }

  delete(key: string): void {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.onEvict(key, value);
    }
  }

  clear(): void {
    for (const [key, value] of [...this.entries]) {
      this.entries.delete(key);
      this.onEvict(key, value);
    }
  }
}
