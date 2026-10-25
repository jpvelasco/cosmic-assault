import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockSeed, E2E_QUERY_MARK, parseLives, parseSeed } from '../../src/app/seed';

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
    ['2', 2],
    ['3', 3],
  ])('accepts %s', (raw, lives) => {
    expect(parseLives(raw)).toBe(lives);
  });

  it.each(['', '0', '4', '-1', '1.5', 'two', ' 1', '1e0'])('warns (not errors) and ignores %j', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error');
    expect(parseLives(raw)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`?lives=${raw}: it must be an integer from 1 to 3`));
    expect(error).not.toHaveBeenCalled();
  });
});

describe('e2e query warnings', () => {
  // scripts/check-no-bridge.mjs proves the release build drops this parsing by looking for the mark.
  it.each([
    ['seed', parseSeed],
    ['lives', parseLives],
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
