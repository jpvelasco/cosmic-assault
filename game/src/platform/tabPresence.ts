/** The slice of `BroadcastChannel` presence needs, so tests can pass a fake. */
export interface PresenceChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  close(): void;
}

export interface TabPresence {
  /** Asks the other tabs whether one is playing the Rank run saved at `runSeq`; resolves true if one answers in time. */
  probe(runSeq: number): Promise<boolean>;
  /** Answers probes for `runSeq` (the Rank galaxy this tab is playing) until the returned function is called. */
  own(runSeq: number): () => void;
  dispose(): void;
}

export const PRESENCE_CHANNEL = 'cosmic-assault.v2';
/** How long a probe waits for an owner to answer. */
export const PROBE_MS = 300;

type PresenceMessage = { readonly kind: 'probe' | 'owner'; readonly runSeq: number };

function isPresenceMessage(data: unknown): data is PresenceMessage {
  if (typeof data !== 'object' || data === null) return false;
  const { kind, runSeq } = data as Record<string, unknown>;
  return (kind === 'probe' || kind === 'owner') && typeof runSeq === 'number';
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
  /** Every probe still waiting, by the run it asks about: one owner's answer settles them all. */
  const waiting = new Map<number, Set<(answered: boolean) => void>>();
  const settle = (runSeq: number, answered: boolean): void => {
    const waiters = waiting.get(runSeq);
    waiting.delete(runSeq);
    waiters?.forEach((done) => {
      done(answered);
    });
  };
  channel?.addEventListener('message', ({ data }) => {
    if (!isPresenceMessage(data)) return;
    if (data.kind === 'probe' && owned.has(data.runSeq)) channel.postMessage({ kind: 'owner', runSeq: data.runSeq });
    if (data.kind === 'owner') settle(data.runSeq, true);
  });

  return {
    probe(runSeq) {
      if (channel === null) return Promise.resolve(false);
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
        channel.postMessage({ kind: 'probe', runSeq });
      });
    },
    own(runSeq) {
      owned.add(runSeq);
      return () => {
        owned.delete(runSeq);
      };
    },
    /** Stops answering, and settles every pending probe as unanswered. */
    dispose() {
      owned.clear();
      for (const runSeq of [...waiting.keys()]) settle(runSeq, false);
      channel?.close();
    },
  };
}
