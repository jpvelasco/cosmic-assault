import { DEFAULT_LOOK, SKIN_IDS, TRAIL_IDS, type SkinId, type TrailId } from '../content/cosmetics';

/** Screen shake: follows the system's reduced-motion preference (`auto`), or is switched on or off outright. */
export type ScreenShake = 'auto' | 'on' | 'off';

const SCREEN_SHAKES: readonly ScreenShake[] = ['auto', 'on', 'off'];

export interface Settings {
  readonly muted: boolean;
  /** 0–1 */
  readonly musicVolume: number;
  /** 0–1 */
  readonly sfxVolume: number;
  readonly screenShake: ScreenShake;
  /** Swaps the touch joystick and FIRE button. */
  readonly leftHanded: boolean;
  /** The hull's trim the player chose; drawn only once unlocked (see meta/cosmetics.ts). */
  readonly skin: SkinId;
  /** The engine trail the player chose; drawn only once unlocked. */
  readonly trail: TrailId;
}

export const SETTINGS_KEY = 'cosmic-assault.v2.settings';

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  muted: false,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  screenShake: 'auto',
  leftHanded: false,
  skin: DEFAULT_LOOK.skin,
  trail: DEFAULT_LOOK.trail,
});

function isVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function volume(value: unknown, fallback: number): number {
  return isVolume(value) ? value : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

/** Whether the screen shakes. `auto` follows the system's reduced-motion preference; `on` and `off` are the player's explicit choice and override it. */
export function shakeEnabled(setting: ScreenShake, reducedMotion: boolean): boolean {
  return setting === 'auto' ? !reducedMotion : setting === 'on';
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
    muted: flag(saved['muted'], DEFAULT_SETTINGS.muted),
    musicVolume: volume(saved['musicVolume'], DEFAULT_SETTINGS.musicVolume),
    sfxVolume: volume(saved['sfxVolume'], DEFAULT_SETTINGS.sfxVolume),
    screenShake: oneOf(SCREEN_SHAKES, saved['screenShake'], DEFAULT_SETTINGS.screenShake),
    leftHanded: flag(saved['leftHanded'], DEFAULT_SETTINGS.leftHanded),
    skin: oneOf(SKIN_IDS, saved['skin'], DEFAULT_SETTINGS.skin),
    trail: oneOf(TRAIL_IDS, saved['trail'], DEFAULT_SETTINGS.trail),
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
