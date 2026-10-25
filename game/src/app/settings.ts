export interface Settings {
  readonly muted: boolean;
  /** 0–1 */
  readonly musicVolume: number;
  /** 0–1 */
  readonly sfxVolume: number;
}

export const SETTINGS_KEY = 'cosmic-assault.v2.settings';

export const DEFAULT_SETTINGS: Settings = { muted: false, musicVolume: 0.6, sfxVolume: 0.8 };

function isVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function volume(value: unknown, fallback: number): number {
  return isVolume(value) ? value : fallback;
}

/** `window.localStorage`, or null where the browser refuses access (privacy modes, sandboxed frames) or has none. */
export function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The saved settings. Each field is checked on its own, so one bad value costs only that field;
 * missing, corrupt or unreadable storage gives the defaults. Never throws.
 */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null): Settings {
  let parsed: unknown;
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (raw === null || raw === undefined) return DEFAULT_SETTINGS;
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
  const saved = parsed as Record<string, unknown>;
  return {
    muted: typeof saved['muted'] === 'boolean' ? saved['muted'] : DEFAULT_SETTINGS.muted,
    musicVolume: volume(saved['musicVolume'], DEFAULT_SETTINGS.musicVolume),
    sfxVolume: volume(saved['sfxVolume'], DEFAULT_SETTINGS.sfxVolume),
  };
}

/** Saves `settings`; false when there is no storage or the write fails (full, blocked), so callers can warn. */
export function saveSettings(storage: Pick<Storage, 'setItem'> | null, settings: Settings): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
