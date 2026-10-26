import { describe, expect, it, vi } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { createSaveStore, CLASSIC_HIGH_SCORE_KEY, type StorageEvents } from '../../src/app/saveStore';
import { recordClear, setRankRun } from '../../src/meta/progress';
import { startRank } from '../../src/meta/rankRun';
import { defaultSave, SAVE_KEY, type SaveData } from '../../src/meta/save';
import { RingLog } from '../../src/platform/log';

class FakeStorage {
  readonly items = new Map<string, string>();
  gets = 0;
  sets = 0;
  getItem(key: string): string | null {
    this.gets++;
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.sets++;
    this.items.set(key, value);
  }
  /** Another tab's write. */
  external(key: string, save: unknown): void {
    this.items.set(key, JSON.stringify(save));
  }
}

class FakeWindow implements StorageEvents {
  private readonly listeners = new Set<(e: { key: string | null }) => void>();
  addEventListener(_type: 'storage', listener: (e: { key: string | null }) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'storage', listener: (e: { key: string | null }) => void): void {
    this.listeners.delete(listener);
  }
  fire(key: string | null): void {
    for (const l of [...this.listeners]) l({ key });
  }
  get count(): number {
    return this.listeners.size;
  }
}

const stored = (s: FakeStorage): SaveData => JSON.parse(s.items.get(SAVE_KEY) ?? 'null') as SaveData;
const clear = (save: SaveData, id: Parameters<typeof galaxyById>[0], score = 100, stars: 1 | 2 | 3 = 1): SaveData => recordClear(save, galaxyById(id), score, stars);

describe('load', () => {
  it('gives the defaults for empty storage, no storage, truncated JSON and the wrong shape', () => {
    expect(createSaveStore({ storage: new FakeStorage(), events: new FakeWindow() }).load()).toEqual(defaultSave());
    expect(createSaveStore({ storage: null, events: new FakeWindow() }).load()).toEqual(defaultSave());
    for (const raw of ['{"frontier":"2-3","gal', 'null', '[]', '7']) {
      const storage = new FakeStorage();
      storage.items.set(SAVE_KEY, raw);
      expect(createSaveStore({ storage, events: new FakeWindow() }).load()).toEqual(defaultSave());
    }
  });

  it('reads and sanitizes a stored save', () => {
    const storage = new FakeStorage();
    storage.external(SAVE_KEY, { frontier: '3-2', galaxies: { '1-1': { bestScore: 5, stars: 9 }, '8-8': {} }, version: 9 });
    const save = createSaveStore({ storage, events: new FakeWindow() }).load();
    expect(save.frontier).toBe('3-2');
    expect(save.galaxies).toEqual({ '1-1': { bestScore: 5, stars: 3 } });
  });

  it('does not throw when storage throws, and gives the defaults', () => {
    const angry = {
      getItem: (): never => {
        throw new Error('SecurityError');
      },
      setItem: (): never => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createSaveStore({ storage: angry, events: new FakeWindow() });
    expect(store.load()).toEqual(defaultSave());
    expect(() => store.update((s) => clear(s, '1-1'))).not.toThrow();
    expect(store.save.frontier).toBe('1-2');
    expect(() => store.importClassicOnce()).not.toThrow();
    expect(store.save.classicImported).toBe(false);
  });
});

describe('update', () => {
  it('applies the change, writes it under the save key and returns it', () => {
    const storage = new FakeStorage();
    const store = createSaveStore({ storage, events: new FakeWindow() });
    const next = store.update((s) => clear(s, '1-1', 700, 2));
    expect(next.frontier).toBe('1-2');
    expect(store.save).toEqual(next);
    expect(stored(storage)).toEqual(next);
  });

  it('re-reads storage before writing, so a stale tab cannot overwrite a newer frontier', () => {
    const storage = new FakeStorage();
    const store = createSaveStore({ storage, events: new FakeWindow() });
    store.load();
    storage.external(SAVE_KEY, clear(clear(defaultSave(), '1-1', 900, 3), '1-2', 50, 1)); // another tab got to 1-3
    const next = store.update((s) => clear(s, '1-1', 300, 1)); // this tab only knows about 1-1
    expect(next.frontier).toBe('1-3');
    expect(next.galaxies['1-1']).toEqual({ bestScore: 900, stars: 3 });
    expect(next.galaxies['1-2']).toEqual({ bestScore: 50, stars: 1 });
    expect(stored(storage)).toEqual(next);
  });

  it('merges before applying the change, so the change sees the other tab and its own result wins', () => {
    const storage = new FakeStorage();
    const store = createSaveStore({ storage, events: new FakeWindow() });
    storage.external(SAVE_KEY, { ...defaultSave(), rankBoard: [{ score: 10, reached: 'D1 · G1', date: '2026-10-25', continued: false }] });
    const seen: number[] = [];
    const next = store.update((s) => {
      seen.push(s.rankBoard.length);
      return { ...s, rankBoard: [], classicBest: 77 };
    });
    expect(seen).toEqual([1]);
    expect(next).toMatchObject({ rankBoard: [], classicBest: 77 });
    expect(stored(storage)).toMatchObject({ rankBoard: [], classicBest: 77 });
  });

  it('survives a corrupt stored value by writing a clean save', () => {
    const storage = new FakeStorage();
    storage.items.set(SAVE_KEY, '{oops');
    const store = createSaveStore({ storage, events: new FakeWindow() });
    store.update((s) => clear(s, '1-1'));
    expect(stored(storage).frontier).toBe('1-2');
  });

  it('with writes off, changes memory only and never touches storage', () => {
    const storage = new FakeStorage();
    const store = createSaveStore({ storage, events: new FakeWindow(), writes: false });
    expect(store.writes).toBe(false);
    expect(createSaveStore({ storage, events: new FakeWindow() }).writes).toBe(true);
    const next = store.update((s) => clear(s, '1-1'));
    expect(next.frontier).toBe('1-2');
    expect(store.save.frontier).toBe('1-2');
    expect(storage.sets).toBe(0);
    expect(storage.items.has(SAVE_KEY)).toBe(false);
  });

  it('with writes off, still keeps what is already stored', () => {
    const storage = new FakeStorage();
    storage.external(SAVE_KEY, clear(defaultSave(), '1-1'));
    const store = createSaveStore({ storage, events: new FakeWindow(), writes: false });
    expect(store.update((s) => s).frontier).toBe('1-2');
    expect(storage.sets).toBe(0);
  });
});

describe('update after a failed read', () => {
  const REAL = clear(clear(defaultSave(), '1-1', 900, 3), '1-2');

  /** Reads fail while `unreadable` is set; writes always work. */
  function flaky(storage: FakeStorage): { getItem: (key: string) => string | null; setItem: FakeStorage['setItem']; unreadable: boolean } {
    const self = {
      unreadable: true,
      getItem: (key: string): string | null => {
        if (self.unreadable) throw new Error('SecurityError');
        return storage.getItem(key);
      },
      setItem: (key: string, value: string): void => {
        storage.setItem(key, value);
      },
    };
    return self;
  }

  it('leaves the stored save byte-identical, keeps the change in memory and reports it once', () => {
    const backing = new FakeStorage();
    backing.external(SAVE_KEY, REAL);
    const before = backing.items.get(SAVE_KEY);
    const store = createSaveStore({ storage: flaky(backing), events: new FakeWindow() });
    const failed = vi.fn();
    store.onWriteFailure(failed);
    expect(store.update((s) => clear(s, '1-3')).frontier).toBe('1-4');
    store.update((s) => s);
    expect(backing.items.get(SAVE_KEY)).toBe(before);
    expect(backing.sets).toBe(0);
    expect(store.save.frontier).toBe('1-4');
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('writes again, merged with what was really stored, once reads work', () => {
    const backing = new FakeStorage();
    backing.external(SAVE_KEY, REAL);
    const storage = flaky(backing);
    const store = createSaveStore({ storage, events: new FakeWindow() });
    store.load();
    store.update((s) => clear(s, '1-3'));
    storage.unreadable = false;
    const next = store.update((s) => s);
    expect(next.galaxies['1-1']).toEqual({ bestScore: 900, stars: 3 });
    expect(next.frontier).toBe('1-4');
    expect(stored(backing)).toEqual(next);
  });

  it('a first read that fails is fine: load keeps the defaults without throwing', () => {
    const store = createSaveStore({ storage: flaky(new FakeStorage()), events: new FakeWindow() });
    expect(store.load()).toEqual(defaultSave());
  });

  it('a read that finds nothing stored (null) still writes', () => {
    const backing = new FakeStorage();
    const store = createSaveStore({ storage: backing, events: new FakeWindow() });
    const failed = vi.fn();
    store.onWriteFailure(failed);
    store.update((s) => clear(s, '1-1'));
    expect(stored(backing).frontier).toBe('1-2');
    expect(failed).not.toHaveBeenCalled();
  });

  it('an unreadable store with writes off stays silent and writes nothing', () => {
    const backing = new FakeStorage();
    const store = createSaveStore({ storage: flaky(backing), events: new FakeWindow(), writes: false });
    const failed = vi.fn();
    store.onWriteFailure(failed);
    store.update((s) => s);
    expect(backing.sets).toBe(0);
    expect(failed).not.toHaveBeenCalled();
  });
});

describe('onExternalChange', () => {
  it('adopts another tab save for the save key, merges it into memory, then calls back', () => {
    const storage = new FakeStorage();
    const win = new FakeWindow();
    const store = createSaveStore({ storage, events: win });
    store.update((s) => clear(s, '1-1', 100, 1));
    const cb = vi.fn<(save: SaveData) => void>();
    store.onExternalChange(cb);
    storage.external(SAVE_KEY, clear(clear(defaultSave(), '1-1', 900, 3), '1-2'));
    win.fire(SAVE_KEY);
    expect(cb).toHaveBeenCalledTimes(1);
    const adopted = cb.mock.calls[0]?.[0];
    expect(adopted?.frontier).toBe('1-3');
    expect(adopted?.galaxies['1-1']).toEqual({ bestScore: 900, stars: 3 });
    expect(store.save).toEqual(adopted);
  });

  it('ignores other keys, including the settings key', () => {
    const win = new FakeWindow();
    const store = createSaveStore({ storage: new FakeStorage(), events: win });
    const cb = vi.fn();
    store.onExternalChange(cb);
    win.fire('cosmic-assault.v2.settings');
    win.fire('something-else');
    expect(cb).not.toHaveBeenCalled();
  });

  it('reloads and merges on a cleared storage (key null), keeping what memory had', () => {
    const storage = new FakeStorage();
    const win = new FakeWindow();
    const store = createSaveStore({ storage, events: win });
    store.update((s) => clear(s, '1-1', 100, 1));
    const cb = vi.fn<(save: SaveData) => void>();
    store.onExternalChange(cb);
    // Another tab ran localStorage.clear(), then wrote a save of its own before this tab heard.
    storage.items.clear();
    storage.external(SAVE_KEY, clear(defaultSave(), '1-1', 900, 3));
    const reads = storage.gets;
    win.fire(null);
    expect(storage.gets).toBe(reads + 1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.save.frontier).toBe('1-2');
    expect(store.save.galaxies['1-1']).toEqual({ bestScore: 900, stars: 3 });
    expect(cb.mock.calls[0]?.[0]).toEqual(store.save);
  });

  it('does not let a corrupt external write damage memory', () => {
    const storage = new FakeStorage();
    const win = new FakeWindow();
    const store = createSaveStore({ storage, events: win });
    store.update((s) => clear(s, '1-1'));
    store.onExternalChange(() => undefined);
    storage.items.set(SAVE_KEY, '{truncated');
    win.fire(SAVE_KEY);
    expect(store.save.frontier).toBe('1-2');
  });

  it('stops listening when the returned function is called', () => {
    const win = new FakeWindow();
    const store = createSaveStore({ storage: new FakeStorage(), events: win });
    const cb = vi.fn();
    const stop = store.onExternalChange(cb);
    expect(win.count).toBe(1);
    stop();
    expect(win.count).toBe(0);
    win.fire(SAVE_KEY);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('importClassicOnce', () => {
  it('copies the classic high score once, marks it imported and never deletes the legacy key', () => {
    const storage = new FakeStorage();
    storage.items.set(CLASSIC_HIGH_SCORE_KEY, '48250');
    const store = createSaveStore({ storage, events: new FakeWindow() });
    const first = store.importClassicOnce();
    expect(first).toMatchObject({ classicBest: 48250, classicImported: true });
    expect(stored(storage)).toMatchObject({ classicBest: 48250, classicImported: true });
    expect(storage.items.get(CLASSIC_HIGH_SCORE_KEY)).toBe('48250');
  });

  it('does not import again when the legacy score changes later or in a new session', () => {
    const storage = new FakeStorage();
    storage.items.set(CLASSIC_HIGH_SCORE_KEY, '100');
    createSaveStore({ storage, events: new FakeWindow() }).importClassicOnce();
    storage.items.set(CLASSIC_HIGH_SCORE_KEY, '99999');
    const again = createSaveStore({ storage, events: new FakeWindow() });
    expect(again.importClassicOnce().classicBest).toBe(100);
    expect(again.importClassicOnce().classicBest).toBe(100);
  });

  it('does not read the legacy key once imported', () => {
    const storage = new FakeStorage();
    storage.items.set(CLASSIC_HIGH_SCORE_KEY, '100');
    const store = createSaveStore({ storage, events: new FakeWindow() });
    store.importClassicOnce();
    const getItem = vi.spyOn(storage, 'getItem');
    store.importClassicOnce();
    expect(getItem.mock.calls.some(([key]) => key === CLASSIC_HIGH_SCORE_KEY)).toBe(false);
  });

  it.each([null, '', 'abc', '-5', '12.5', '0', '1e3', '99999999999999999999'])('imports no score from legacy value %j but still marks the import done', (raw) => {
    const storage = new FakeStorage();
    if (raw !== null) storage.items.set(CLASSIC_HIGH_SCORE_KEY, raw);
    const save = createSaveStore({ storage, events: new FakeWindow() }).importClassicOnce();
    expect(save).toMatchObject({ classicBest: null, classicImported: true });
  });

  it('keeps a larger classic best another tab already stored', () => {
    const storage = new FakeStorage();
    storage.items.set(CLASSIC_HIGH_SCORE_KEY, '100');
    storage.external(SAVE_KEY, { ...defaultSave(), classicBest: 500 });
    expect(createSaveStore({ storage, events: new FakeWindow() }).importClassicOnce()).toMatchObject({ classicBest: 500, classicImported: true });
  });

  it('with writes off, imports into memory only', () => {
    const storage = new FakeStorage();
    storage.items.set(CLASSIC_HIGH_SCORE_KEY, '100');
    const store = createSaveStore({ storage, events: new FakeWindow(), writes: false });
    expect(store.importClassicOnce().classicBest).toBe(100);
    expect(storage.items.has(SAVE_KEY)).toBe(false);
  });
});

describe('two tabs and the Rank run', () => {
  function twoTabs(): { storage: FakeStorage; a: ReturnType<typeof createSaveStore>; b: ReturnType<typeof createSaveStore>; winB: FakeWindow } {
    const storage = new FakeStorage();
    const winB = new FakeWindow();
    return { storage, a: createSaveStore({ storage, events: new FakeWindow() }), b: createSaveStore({ storage, events: winB }), winB };
  }

  it('a stale tab does not bring back a run that another tab abandoned', () => {
    const { a, b } = twoTabs();
    a.update((s) => setRankRun(s, startRank('2026-10-26')));
    b.load();
    expect(b.save.rankRun).not.toBeNull();
    a.update((s) => setRankRun(s, null));
    expect(b.update((s) => s).rankRun).toBeNull();
    expect(a.load().rankRun).toBeNull();
  });

  it('a stale tab adopts the end of a run through the storage event, and does not revive it', () => {
    const { a, b, winB } = twoTabs();
    a.update((s) => setRankRun(s, startRank('2026-10-26')));
    b.load();
    const adopted = vi.fn<(save: SaveData) => void>();
    b.onExternalChange(adopted);
    a.update((s) => setRankRun(s, null));
    winB.fire(SAVE_KEY);
    expect(adopted).toHaveBeenCalledWith(expect.objectContaining({ rankRun: null, rankSeq: 2 }));
    b.update((s) => ({ ...s, classicBest: 5 }));
    expect(a.load()).toMatchObject({ rankRun: null, classicBest: 5 });
  });

  it('a run restarted in one tab beats the stale older run in the other', () => {
    const { a, b } = twoTabs();
    a.update((s) => setRankRun(s, { ...startRank('2026-10-26'), next: '3-2', score: 9000 }));
    b.load();
    a.update((s) => setRankRun(setRankRun(s, null), startRank('2026-10-27')));
    expect(b.load().rankRun).toMatchObject({ next: '1-1', score: 0, startedAt: '2026-10-27' });
  });
});

describe('onWriteFailure', () => {
  const failing = (storage: FakeStorage): { getItem: FakeStorage['getItem']; setItem: () => never } => ({
    getItem: (key) => storage.getItem(key),
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  });

  it('fires once, on the first failed write, however many follow', () => {
    const store = createSaveStore({ storage: failing(new FakeStorage()), events: new FakeWindow() });
    const cb = vi.fn();
    store.onWriteFailure(cb);
    store.update((s) => s);
    store.update((s) => s);
    store.importClassicOnce();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire when writes succeed', () => {
    const store = createSaveStore({ storage: new FakeStorage(), events: new FakeWindow() });
    const cb = vi.fn();
    store.onWriteFailure(cb);
    store.update((s) => clear(s, '1-1'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('never fires with writes off, even on storage that would refuse', () => {
    const store = createSaveStore({ storage: failing(new FakeStorage()), events: new FakeWindow(), writes: false });
    const cb = vi.fn();
    store.onWriteFailure(cb);
    store.update((s) => s);
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires when there is no storage at all, since nothing is kept', () => {
    const store = createSaveStore({ storage: null, events: new FakeWindow() });
    const cb = vi.fn();
    store.onWriteFailure(cb);
    store.update((s) => s);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('tells a callback registered after the failure straight away, and the change is still kept in memory', () => {
    const store = createSaveStore({ storage: failing(new FakeStorage()), events: new FakeWindow() });
    store.update((s) => clear(s, '1-1'));
    const late = vi.fn();
    store.onWriteFailure(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(store.save.frontier).toBe('1-2');
  });

  it('a listener that throws cannot break update: the change is kept, other listeners still hear, and the log says so', () => {
    const log = new RingLog();
    const store = createSaveStore({ storage: failing(new FakeStorage()), events: new FakeWindow(), log });
    const after = vi.fn();
    store.onWriteFailure(() => {
      throw new Error('toast exploded');
    });
    store.onWriteFailure(after);
    expect(() => store.update((s) => clear(s, '1-1'))).not.toThrow();
    expect(store.save.frontier).toBe('1-2');
    expect(after).toHaveBeenCalledTimes(1);
    expect(log.entries()).toEqual([expect.objectContaining({ kind: 'error', message: expect.stringContaining('toast exploded') as string })]);
  });

  it('a listener added after the failure that throws is logged too, not thrown', () => {
    const log = new RingLog();
    const store = createSaveStore({ storage: null, events: new FakeWindow(), log });
    store.update((s) => s);
    expect(() =>
      store.onWriteFailure(() => {
        throw new Error('late boom');
      }),
    ).not.toThrow();
    expect(log.entries()).toEqual([expect.objectContaining({ kind: 'error', message: expect.stringContaining('late boom') as string })]);
  });

  it('stops calling a callback after it unsubscribes', () => {
    const store = createSaveStore({ storage: failing(new FakeStorage()), events: new FakeWindow() });
    const cb = vi.fn();
    store.onWriteFailure(cb)();
    store.update((s) => s);
    expect(cb).not.toHaveBeenCalled();
  });
});
