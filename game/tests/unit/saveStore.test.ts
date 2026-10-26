import { describe, expect, it, vi } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { createSaveStore, CLASSIC_HIGH_SCORE_KEY, type StorageEvents } from '../../src/app/saveStore';
import { recordClear } from '../../src/meta/progress';
import { defaultSave, SAVE_KEY, type SaveData } from '../../src/meta/save';

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
    store.update((s) => {
      seen.push(s.rankBoard.length);
      return s;
    });
    expect(seen).toEqual([1]);
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
    win.fire(null);
    expect(cb).not.toHaveBeenCalled();
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
