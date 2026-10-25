/**
 * Blocks the keys held when a run starts until each is released, so the key that
 * started the run does not also fire or steer (the live game resets input on start).
 */
export interface KeyLatch {
  /** Blocks every code in `held` (a copy is kept) and forgets earlier latches. */
  latch(held: ReadonlySet<string>): void;
  /** Unblocks `code` on a fresh (non-repeat) press, which proves it was released even between frames. */
  release(code: string): void;
  /** Releases latched codes no longer held, then returns `held` without the still-latched ones. */
  active(held: ReadonlySet<string>): ReadonlySet<string>;
}

export function createKeyLatch(): KeyLatch {
  let latched = new Set<string>();
  return {
    latch(held) {
      latched = new Set(held);
    },
    release(code) {
      latched.delete(code);
    },
    active(held) {
      for (const code of latched) {
        if (!held.has(code)) latched.delete(code);
      }
      if (latched.size === 0) return held;
      return new Set([...held].filter((code) => !latched.has(code)));
    },
  };
}
