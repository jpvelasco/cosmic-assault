import { SAVE_KEY, type SaveData } from '../../src/meta/save';

/** A Map-backed `localStorage` stand-in, optionally holding `initial` under the save key. Share one to model two tabs. */
export function memoryStorage(initial?: SaveData): Pick<Storage, 'getItem' | 'setItem'> & { readonly items: Map<string, string> } {
  const items = new Map<string, string>(initial === undefined ? [] : [[SAVE_KEY, JSON.stringify(initial)]]);
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}
