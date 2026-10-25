export type LogKind = 'error' | 'stall' | 'mode' | 'event';

export interface LogEntry {
  /** Milliseconds on the page's clock (`performance.now()`). */
  readonly t: number;
  readonly kind: LogKind;
  readonly message: string;
}

const DEFAULT_CAPACITY = 200;
/** Long messages (stack traces) are cut to this, so 200 entries stay small enough to copy and paste. */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * A fixed-size in-memory log: once full, each new entry replaces the oldest. It lives only in the page,
 * so nothing leaves the device unless the player copies the report.
 */
export class RingLog {
  private readonly slots: LogEntry[] = [];
  private readonly capacity: number;
  /** Where the next entry goes once the ring is full; also the oldest entry's slot. */
  private next = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`RingLog capacity must be a positive whole number, got ${String(capacity)}; pass 1 or more`);
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.slots.length;
  }

  add(kind: LogKind, message: string, t: number): void {
    const entry = { t, kind, message: message.slice(0, MAX_MESSAGE_LENGTH) };
    if (this.slots.length < this.capacity) {
      this.slots.push(entry);
      return;
    }
    this.slots[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
  }

  /** A copy of the entries, oldest first. */
  entries(): LogEntry[] {
    return [...this.slots.slice(this.next), ...this.slots.slice(0, this.next)];
  }

  /** The entries and `meta` as JSON text, for the player to copy into a bug report. */
  report(meta: Record<string, string>): string {
    return JSON.stringify({ meta, entries: this.entries() }, null, 2);
  }
}
