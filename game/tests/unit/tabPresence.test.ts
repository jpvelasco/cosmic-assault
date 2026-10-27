import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTabPresence, PROBE_MS, type PresenceChannel } from '../../src/platform/tabPresence';

/** Channels on one in-memory bus: a message reaches every other channel, as BroadcastChannel does between tabs. */
function bus(): () => PresenceChannel & { closed: boolean } {
  const channels = new Set<{ deliver: (data: unknown) => void }>();
  return () => {
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const self = {
      closed: false,
      deliver: (data: unknown) => {
        for (const listener of listeners) listener({ data });
      },
      postMessage(message: unknown) {
        for (const other of channels) if (other !== self) other.deliver(structuredClone(message));
      },
      addEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
        listeners.push(listener);
      },
      close() {
        self.closed = true;
        channels.delete(self);
      },
    };
    channels.add(self);
    return self;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createTabPresence', () => {
  it('a tab that owns the run answers, so the probe resolves true at once', async () => {
    const open = bus();
    const playing = createTabPresence(open());
    playing.own(7);
    await expect(createTabPresence(open()).probe(7)).resolves.toBe(true);
  });

  it('silence for the probe window resolves false: no tab owns that run', async () => {
    vi.useFakeTimers();
    const open = bus();
    createTabPresence(open()).own(6);
    const probe = createTabPresence(open()).probe(7);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(probe).resolves.toBe(false);
  });

  it('stops answering once the owner lets go, and after dispose', async () => {
    vi.useFakeTimers();
    const open = bus();
    const playing = createTabPresence(open());
    const release = playing.own(3);
    release();
    const probe = createTabPresence(open()).probe(3);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(probe).resolves.toBe(false);
    const again = createTabPresence(open());
    again.own(4);
    again.dispose();
    const late = createTabPresence(open()).probe(4);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(late).resolves.toBe(false);
  });

  it('without a channel, probes find no one at once and owning does nothing', async () => {
    const lonely = createTabPresence(null);
    expect(() => {
      lonely.own(1)();
    }).not.toThrow();
    await expect(lonely.probe(1)).resolves.toBe(false);
  });

  it('ignores messages that are not its own', async () => {
    vi.useFakeTimers();
    const open = bus();
    const stranger = open();
    const probe = createTabPresence(open()).probe(2);
    stranger.postMessage({ kind: 'owner', runSeq: '2' });
    stranger.postMessage('owner');
    vi.advanceTimersByTime(PROBE_MS);
    await expect(probe).resolves.toBe(false);
  });

  it('one answer settles every probe waiting on that run, however they overlap', async () => {
    vi.useFakeTimers();
    const open = bus();
    const playing = createTabPresence(open());
    const asking = createTabPresence(open());
    // Both probes go out before the owner exists; the second one's answer must settle the first too.
    const first = asking.probe(5);
    vi.advanceTimersByTime(PROBE_MS / 2);
    playing.own(5);
    const second = asking.probe(5);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(first).resolves.toBe(true);
  });

  it('owning a run announces it at once, to tabs already listening', () => {
    const open = bus();
    const watcher = open();
    const heard: unknown[] = [];
    watcher.addEventListener('message', ({ data }) => {
      heard.push(data);
    });
    createTabPresence(open()).own(7);
    expect(heard).toEqual([{ kind: 'claim', runSeq: 7 }]);
  });

  it('a probe for a run whose owner was already heard resolves at once, without asking', async () => {
    vi.useFakeTimers();
    const open = bus();
    const asking = createTabPresence(open());
    const asked: unknown[] = [];
    const watcher = open();
    watcher.addEventListener('message', ({ data }) => {
      asked.push(data);
    });
    createTabPresence(open()).own(7);
    await expect(asking.probe(7)).resolves.toBe(true);
    expect(asked).toEqual([{ kind: 'claim', runSeq: 7 }]);
  });

  it('a heard owner answers one probe only: the next one asks again, so a tab that has closed is found', async () => {
    vi.useFakeTimers();
    const open = bus();
    const asking = createTabPresence(open());
    const playing = createTabPresence(open());
    playing.own(7);
    // The owner's tab goes away without a release: nothing answers from here on.
    playing.dispose();
    await expect(asking.probe(7)).resolves.toBe(true);
    const again = asking.probe(7);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(again).resolves.toBe(false);
  });

  it('a heard owner that has since let go is not believed', async () => {
    vi.useFakeTimers();
    const open = bus();
    const asking = createTabPresence(open());
    const playing = createTabPresence(open());
    playing.own(7)();
    const probe = asking.probe(7);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(probe).resolves.toBe(false);
  });

  it('an owner that answers after a probe timed out is heard by the next one', async () => {
    vi.useFakeTimers();
    const open = bus();
    const asking = createTabPresence(open());
    const first = asking.probe(9);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(first).resolves.toBe(false);
    createTabPresence(open()).own(9);
    await expect(asking.probe(9)).resolves.toBe(true);
  });

  it('an owner that announces while a probe waits settles that probe, and the claim is not kept for the next', async () => {
    vi.useFakeTimers();
    const open = bus();
    const asking = createTabPresence(open());
    const waiting = asking.probe(4);
    const owner = createTabPresence(open());
    owner.own(4);
    await expect(waiting).resolves.toBe(true);
    owner.dispose();
    const next = asking.probe(4);
    vi.advanceTimersByTime(PROBE_MS);
    await expect(next).resolves.toBe(false);
  });

  it('dispose settles a pending probe as unanswered', async () => {
    const asking = createTabPresence(bus()());
    const pending = asking.probe(8);
    asking.dispose();
    await expect(pending).resolves.toBe(false);
  });
});
