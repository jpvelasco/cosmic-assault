import { mergeSaves, parseSave, SAVE_KEY, defaultSave, type SaveData } from '../meta/save';
import { browserStorage } from './settings';

/** The classic game's high score: a plain integer string. Read once and never deleted. */
export const CLASSIC_HIGH_SCORE_KEY = 'cosmicAssaultHighScore';

/** The slice of `window` the store listens on. */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (event: { key: string | null }) => void): void;
  removeEventListener(type: 'storage', listener: (event: { key: string | null }) => void): void;
}

export interface SaveStoreOptions {
  /** Defaults to `localStorage`; null where the browser refuses it. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly events?: StorageEvents;
  /** False for debug runs: changes stay in memory and storage is never written. */
  readonly writes?: boolean;
}

export interface SaveStore {
  /** The in-memory save, as of the last load, update or external change. */
  readonly save: SaveData;
  /** Reads storage and folds it into memory. */
  load(): SaveData;
  /** Re-reads storage, merges it with memory, applies `change`, writes, and returns the result. */
  update(change: (save: SaveData) => SaveData): SaveData;
  /** Calls back with the merged save when another tab writes one; returns a function that stops listening. */
  onExternalChange(callback: (save: SaveData) => void): () => void;
  /** Copies the classic game's high score into the save, the first time only. */
  importClassicOnce(): SaveData;
}

/** A positive integer score from the classic game's string, else null. */
function parseClassicScore(raw: string | null): number | null {
  const score = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0;
  return Number.isSafeInteger(score) && score > 0 ? score : null;
}

/**
 * The save in `localStorage`. Every storage access is guarded: unreadable storage gives defaults, and a
 * failed write keeps the change in memory for the session. Never throws.
 */
export function createSaveStore(options: SaveStoreOptions = {}): SaveStore {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const events: StorageEvents = options.events ?? window;
  const writes = options.writes ?? true;
  let memory = defaultSave();

  const readStored = (): SaveData => {
    try {
      return parseSave(storage?.getItem(SAVE_KEY) ?? null);
    } catch {
      return defaultSave();
    }
  };
  const merged = (): SaveData => mergeSaves(memory, readStored());

  const store: SaveStore = {
    get save() {
      return memory;
    },
    load() {
      memory = merged();
      return memory;
    },
    update(change) {
      memory = change(merged());
      if (writes) {
        try {
          storage?.setItem(SAVE_KEY, JSON.stringify(memory));
        } catch {
          // Full or blocked storage: the session carries on with the in-memory save.
        }
      }
      return memory;
    },
    onExternalChange(callback) {
      const listener = (event: { key: string | null }): void => {
        if (event.key !== SAVE_KEY) return;
        callback(store.load());
      };
      events.addEventListener('storage', listener);
      return () => {
        events.removeEventListener('storage', listener);
      };
    },
    importClassicOnce() {
      if (store.load().classicImported) return memory;
      let raw: string | null;
      try {
        raw = storage?.getItem(CLASSIC_HIGH_SCORE_KEY) ?? null;
      } catch {
        return memory;
      }
      const classic = parseClassicScore(raw);
      return store.update((s) => ({ ...s, classicBest: Math.max(s.classicBest ?? 0, classic ?? 0) || null, classicImported: true }));
    },
  };
  return store;
}
