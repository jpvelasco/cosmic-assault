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
  const waiting = new Map<number, () => void>();
  channel?.addEventListener('message', ({ data }) => {
    if (!isPresenceMessage(data)) return;
    if (data.kind === 'probe' && owned.has(data.runSeq)) channel.postMessage({ kind: 'owner', runSeq: data.runSeq });
    if (data.kind === 'owner') waiting.get(data.runSeq)?.();
  });

  return {
    probe(runSeq) {
      if (channel === null) return Promise.resolve(false);
      return new Promise((resolve) => {
        const done = (answered: boolean): void => {
          clearTimeout(timer);
          waiting.delete(runSeq);
          resolve(answered);
        };
        const timer = setTimeout(() => {
          done(false);
        }, probeMs);
        waiting.set(runSeq, () => {
          done(true);
        });
        channel.postMessage({ kind: 'probe', runSeq });
      });
    },
    own(runSeq) {
      owned.add(runSeq);
      return () => {
        owned.delete(runSeq);
      };
    },
    dispose() {
      owned.clear();
      channel?.close();
    },
  };
}
