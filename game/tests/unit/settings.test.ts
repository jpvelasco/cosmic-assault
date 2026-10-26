import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorage, DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY, shakeEnabled } from '../../src/app/settings';

const storing = (raw: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => raw });

describe('loadSettings', () => {
  it('uses the namespaced v2 key and the documented defaults', () => {
    expect(SETTINGS_KEY).toBe('cosmic-assault.v2.settings');
    expect(DEFAULT_SETTINGS).toEqual({ muted: false, musicVolume: 0.6, sfxVolume: 0.8, screenShake: 'auto', leftHanded: false });
  });

  it('returns defaults without storage, with a missing key, or when storage throws', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(storing(null))).toEqual(DEFAULT_SETTINGS);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
  });

  it.each(['{not json', '', 'null', '42', '"text"', '[]', 'true'])('returns defaults for corrupt value %j', (raw) => {
    expect(loadSettings(storing(raw))).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields', () => {
    const saved = { muted: true, musicVolume: 0.25, sfxVolume: 1, screenShake: 'off', leftHanded: true };
    expect(loadSettings(storing(JSON.stringify(saved)))).toEqual(saved);
  });

  it('sanitizes field by field, keeping what is valid', () => {
    const raw = JSON.stringify({ muted: true, musicVolume: 3, sfxVolume: 0.5 });
    expect(loadSettings(storing(raw))).toEqual({ ...DEFAULT_SETTINGS, muted: true, sfxVolume: 0.5 });
  });

  it.each([
    [{ muted: 'yes' }, { muted: false }],
    [{ muted: 1 }, { muted: false }],
    [{ musicVolume: -0.1 }, { musicVolume: 0.6 }],
    [{ musicVolume: '0.5' }, { musicVolume: 0.6 }],
    [{ sfxVolume: null }, { sfxVolume: 0.8 }],
    [{ sfxVolume: 1.01 }, { sfxVolume: 0.8 }],
    [{ screenShake: 'x' }, { screenShake: 'auto' }],
    [{ screenShake: 1 }, { screenShake: 'auto' }],
    [{ screenShake: null }, { screenShake: 'auto' }],
    [{ screenShake: 'ON' }, { screenShake: 'auto' }],
    [{ leftHanded: 'yes' }, { leftHanded: false }],
    [{ leftHanded: 1 }, { leftHanded: false }],
    [{ leftHanded: null }, { leftHanded: false }],
  ])('replaces the wrong-typed or out-of-range field in %j', (stored, expected) => {
    expect(loadSettings(storing(JSON.stringify(stored)))).toEqual({ ...DEFAULT_SETTINGS, ...expected });
  });

  it.each(['auto', 'on', 'off'] as const)('keeps the %s shake setting', (screenShake) => {
    expect(loadSettings(storing(JSON.stringify({ screenShake }))).screenShake).toBe(screenShake);
  });

  it('keeps the old fields when a save from before the new settings has none of them', () => {
    const raw = JSON.stringify({ muted: true, musicVolume: 0.25, sfxVolume: 1 });
    expect(loadSettings(storing(raw))).toEqual({ ...DEFAULT_SETTINGS, muted: true, musicVolume: 0.25, sfxVolume: 1 });
  });

  it('replaces non-finite volumes', () => {
    // JSON cannot hold NaN or Infinity, so a hand-built storage models a poisoned value.
    const raw = '{"musicVolume": 1e999, "sfxVolume": 0}';
    expect(loadSettings(storing(raw))).toEqual({ ...DEFAULT_SETTINGS, sfxVolume: 0 });
  });
});

describe('shakeEnabled', () => {
  it.each([
    ['auto', false, true],
    ['auto', true, false],
    ['on', false, true],
    ['on', true, true],
    ['off', false, false],
    ['off', true, false],
  ] as const)('%s with reduced motion %s is %s', (setting, reducedMotion, expected) => {
    expect(shakeEnabled(setting, reducedMotion)).toBe(expected);
  });
});

describe('saveSettings', () => {
  it('writes the settings as JSON under the namespaced key and reports success', () => {
    const setItem = vi.fn();
    const settings = { ...DEFAULT_SETTINGS, muted: true, musicVolume: 0.3, sfxVolume: 0.7 };
    expect(saveSettings({ setItem }, settings)).toBe(true);
    expect(setItem).toHaveBeenCalledWith(SETTINGS_KEY, JSON.stringify(settings));
  });

  it('returns false without storage or when the write throws', () => {
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(saveSettings(full, DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('browserStorage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
    else Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('is the browser storage when it is available', () => {
    const fake = { getItem: vi.fn(), setItem: vi.fn() };
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    expect(browserStorage()).toBe(fake);
  });

  it('is null where reading localStorage throws, as with blocked site data', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    expect(browserStorage()).toBeNull();
  });

  it('is null where localStorage does not exist', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(browserStorage()).toBeNull();
  });
});
