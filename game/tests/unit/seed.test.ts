import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockSeed, E2E_QUERY_MARK, isDebugRun, parseGalaxy, parseLives, parseQuality, parseSeed } from '../../src/app/seed';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseSeed', () => {
  it('returns undefined without warning when no seed is given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseSeed(null)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 0],
    ['42', 42],
    ['4294967295', 0xffffffff],
  ])('accepts the uint32 %s', (raw, seed) => {
    expect(parseSeed(raw)).toBe(seed);
  });

  it('accepts leading zeros as decimal digits', () => {
    expect(parseSeed('007')).toBe(7);
  });

  it.each(['', 'abc', '12abc', '1e9', '0x1f', '-1', '+5', ' 5', '1.5', '4294967296'])(
    'warns (not errors) and ignores %j',
    (raw) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error');
      expect(parseSeed(raw)).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('must be an integer from 0 to 4294967295'));
      expect(error).not.toHaveBeenCalled();
    },
  );
});

describe('parseLives', () => {
  it('returns undefined without warning when no lives are given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseLives(null)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['1', 1],
    ['3', 3],
    ['5', 5],
  ])('accepts %s (Rank runs start with 1 to 5)', (raw, lives) => {
    expect(parseLives(raw)).toBe(lives);
  });

  it.each(['', '0', '6', '-1', '1.5', 'two', ' 1', '1e0'])('warns (not errors) and ignores %j', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error');
    expect(parseLives(raw)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`?lives=${raw}: it must be an integer from 1 to 5`));
    expect(error).not.toHaveBeenCalled();
  });
});

describe('parseGalaxy', () => {
  it('returns undefined without warning when no galaxy is given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseGalaxy(null)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['1-1', '3-5', '5-6'])('accepts %s', (raw) => {
    expect(parseGalaxy(raw)).toBe(raw);
  });

  it.each(['0-1', '6-1', '1-7', '1-0', 'x', '', '11', '1-1 ', '1_1', '5-★'])('warns (not errors) and ignores %j', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error');
    expect(parseGalaxy(raw)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`?galaxy=${raw}: it must be a galaxy from 1-1 to 5-6 (Dimension-galaxy, 6 is the boss)`));
    expect(error).not.toHaveBeenCalled();
  });
});

describe('isDebugRun', () => {
  const none = { seed: undefined, startLives: undefined, quality: undefined, galaxy: undefined };

  it('is true when ?galaxy=, ?seed= or ?lives= is in force, so the run never writes the save', () => {
    expect(isDebugRun({ ...none, galaxy: '1-1' })).toBe(true);
    expect(isDebugRun({ ...none, seed: 0 })).toBe(true);
    expect(isDebugRun({ ...none, startLives: 2 })).toBe(true);
  });

  it('is false with none of them; ?quality= alone changes nothing a save could record', () => {
    expect(isDebugRun(none)).toBe(false);
    expect(isDebugRun({ ...none, quality: 2 })).toBe(false);
  });
});

describe('parseQuality', () => {
  it('returns undefined without warning when no quality is given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseQuality(null)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 0],
    ['3', 3],
    ['high', 0],
    ['medium', 1],
    ['low', 2],
    ['lowest', 3],
  ])('accepts %s as level %i', (raw, index) => {
    expect(parseQuality(raw)).toBe(index);
  });

  it.each(['', '4', '-1', '1.5', 'ultra', 'HIGH', ' low'])('warns (not errors) and ignores %j', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error');
    expect(parseQuality(raw)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`?quality=${raw}: it must be an integer from 0 to 3 (or one of high, medium, low, lowest); adapting to frame time instead`));
    expect(error).not.toHaveBeenCalled();
  });
});

describe('e2e query warnings', () => {
  // scripts/check-no-bridge.mjs proves the release build drops this parsing by looking for the mark.
  it.each([
    ['seed', parseSeed],
    ['lives', parseLives],
    ['quality', parseQuality],
    ['galaxy', parseGalaxy],
  ])('carry the release-build mark for ?%s=', (_name, parse) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    parse('bad');
    expect(E2E_QUERY_MARK).toBe('__E2E_QUERY__');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(E2E_QUERY_MARK));
  });
});

describe('clockSeed', () => {
  it('is an unsigned 32-bit integer', () => {
    const seed = clockSeed();
    expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
  });
});
