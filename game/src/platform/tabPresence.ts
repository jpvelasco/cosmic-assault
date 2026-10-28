/** The slice of `BroadcastChannel` presence needs, so tests can pass a fake. */
export interface PresenceChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  close(): void;
}

export interface TabPresence {
  /** Asks the other tabs whether one is playing the Rank run saved at `runSeq`; resolves true if one answers in time. */
  probe(runSeq: number): Promise<boolean>;
  /**
   * Announces that this tab plays the Rank galaxy `runSeq`, and answers probes for it until the returned function is
   * called, which announces the release.
   */
  own(runSeq: number): () => void;
  dispose(): void;
}

export const PRESENCE_CHANNEL = 'cosmic-assault.v2';
/** How long a probe waits for an owner to answer. */
export const PROBE_MS = 300;

/**
 * `probe` asks who plays a run; `owner` answers that question; `claim` and `release` are an owner's announcements that it
 * started or stopped playing. A claim goes out at once, with the save write that starts the run, so the other tabs hear
 * it even while the owner is too busy to answer a probe.
 */
type PresenceMessage = { readonly kind: 'probe' | 'owner' | 'claim' | 'release'; readonly runSeq: number };

const PRESENCE_KINDS: readonly unknown[] = ['probe', 'owner', 'claim', 'release'];

function isPresenceMessage(data: unknown): data is PresenceMessage {
  if (typeof data !== 'object' || data === null) return false;
  const { kind, runSeq } = data as Record<string, unknown>;
  return PRESENCE_KINDS.includes(kind) && typeof runSeq === 'number';
}

/** The browser's channel, or null where `BroadcastChannel` is missing or refused; then no tab ever answers. */
export function browserChannel(): PresenceChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(PRESENCE_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Which tab is playing a Rank galaxy, asked over one channel. A tab playing one owns it by its `rankSeq`; a tab that
 * boots to a run saved mid-galaxy probes before treating it as left unfinished. Without a channel, probes find no one.
 */
export function createTabPresence(channel: PresenceChannel | null = browserChannel(), probeMs = PROBE_MS): TabPresence {
  const owned = new Set<number>();
  /**
   * Runs another tab claimed while no probe waited on them. The next probe for one of them resolves at once, and then
   * the claim is spent: that probe was the one it answered, and a later probe asks again.
   */
  const claimed = new Set<number>();
  /** Every probe still waiting, by the run it asks about: one owner's answer settles them all. */
  const waiting = new Map<number, Set<(answered: boolean) => void>>();
  let closed = false;
  const isWaiting = (runSeq: number): boolean => (waiting.get(runSeq)?.size ?? 0) > 0;
  const settle = (runSeq: number, answered: boolean): void => {
    const waiters = waiting.get(runSeq);
    waiting.delete(runSeq);
    waiters?.forEach((done) => {
      done(answered);
    });
  };
  /** Posts to the other tabs; nothing once disposed, since a closed channel refuses. */
  const send = (message: PresenceMessage): void => {
    if (channel !== null && !closed) channel.postMessage(message);
  };
  channel?.addEventListener('message', ({ data }) => {
    if (!isPresenceMessage(data)) return;
    switch (data.kind) {
      case 'probe':
        if (owned.has(data.runSeq)) send({ kind: 'owner', runSeq: data.runSeq });
        break;
      case 'owner':
        settle(data.runSeq, true);
        break;
      case 'claim':
        // A claim that arrives while a probe waits answers it; otherwise it is kept for the next probe.
        if (isWaiting(data.runSeq)) settle(data.runSeq, true);
        else claimed.add(data.runSeq);
        break;
      case 'release':
        claimed.delete(data.runSeq);
        break;
    }
  });

  return {
    probe(runSeq) {
      if (channel === null) return Promise.resolve(false);
      if (claimed.delete(runSeq)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(done);
          resolve(false);
        }, probeMs);
        const done = (answered: boolean): void => {
          clearTimeout(timer);
          resolve(answered);
        };
        const waiters = waiting.get(runSeq) ?? new Set();
        waiters.add(done);
        waiting.set(runSeq, waiters);
        send({ kind: 'probe', runSeq });
      });
    },
    own(runSeq) {
      owned.add(runSeq);
      send({ kind: 'claim', runSeq });
      return () => {
        if (!owned.delete(runSeq)) return;
        send({ kind: 'release', runSeq });
      };
    },
    /** Stops answering and claiming, and settles every pending probe as unanswered. */
    dispose() {
      owned.clear();
      claimed.clear();
      for (const runSeq of [...waiting.keys()]) settle(runSeq, false);
      closed = true;
      channel?.close();
    },
  };
}
