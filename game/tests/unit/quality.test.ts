import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS, QualityScaler, UP_WAIT_MS } from '../../src/render/quality';

/** Feeds `ms` of `frameMs`-long frames, stopping early if the level changes; returns ms fed. */
function feed(scaler: QualityScaler, frameMs: number, ms: number): number {
  const start = scaler.index;
  let fed = 0;
  while (fed < ms && scaler.index === start) {
    scaler.sample(frameMs);
    fed += frameMs;
  }
  return fed;
}

describe('QUALITY_LEVELS', () => {
  it('lists high, medium, low and lowest with falling cost', () => {
    expect(QUALITY_LEVELS.map((l) => l.name)).toEqual(['high', 'medium', 'low', 'lowest']);
    expect(QUALITY_LEVELS.map((l) => [l.dprCap, l.glow, l.particles, l.starScale, l.vignette])).toEqual([
      [2, 1, 400, 1, true],
      [1.5, 0.8, 240, 0.75, true],
      [1.25, 0.6, 120, 0.5, false],
      [1, 0.4, 60, 0.35, false],
    ]);
  });
});

describe('QualityScaler', () => {
  it('starts at high unless told otherwise', () => {
    expect(new QualityScaler().index).toBe(0);
    expect(new QualityScaler(2).index).toBe(2);
  });

  it.each([-1, 4, 1.5, Number.NaN])('rejects the start level %s with a fix', (start) => {
    expect(() => new QualityScaler(start)).toThrow(/quality level.*0 to 3/i);
  });

  it('steps down after 1.2 s of frames averaging over 21 ms, not before', () => {
    const scaler = new QualityScaler();
    for (let i = 0; i < 47; i++) scaler.sample(25);
    expect(scaler.index).toBe(0);
    scaler.sample(25);
    expect(scaler.index).toBe(1);
  });

  it('keeps its level while the mean stays at or under 21 ms', () => {
    const scaler = new QualityScaler();
    for (let i = 0; i < 400; i++) scaler.sample(20);
    expect(scaler.index).toBe(0);
  });

  it('judges the mean, so a few slow frames among fast ones do not step down', () => {
    const scaler = new QualityScaler();
    for (let i = 0; i < 100; i++) scaler.sample(i % 20 === 0 ? 100 : 12);
    expect(scaler.index).toBe(0);
  });

  it('keeps stepping down each 1.2 s and stops at lowest', () => {
    const scaler = new QualityScaler();
    for (let i = 0; i < 48 * 6; i++) scaler.sample(25);
    expect(scaler.index).toBe(3);
  });

  it('steps up after 7 s averaging under 17.6 ms, not before', () => {
    const scaler = new QualityScaler(2);
    // 437 frames of 16 ms is 6992 ms: just short of the wait.
    for (let i = 0; i < 437; i++) scaler.sample(16);
    expect(scaler.index).toBe(2);
    scaler.sample(16);
    expect(scaler.index).toBe(1);
  });

  it('does not step up while the mean stays at or over 17.6 ms', () => {
    const scaler = new QualityScaler(2);
    for (let i = 0; i < 1000; i++) scaler.sample(18);
    expect(scaler.index).toBe(2);
  });

  it('stays at high when fast', () => {
    const scaler = new QualityScaler();
    for (let i = 0; i < 2000; i++) scaler.sample(8);
    expect(scaler.index).toBe(0);
  });

  it('doubles the next upgrade wait after a step down within 3 s of an upgrade', () => {
    const scaler = new QualityScaler(1);
    feed(scaler, 16, UP_WAIT_MS + 100);
    expect(scaler.index).toBe(0);
    feed(scaler, 25, 1300);
    expect(scaler.index).toBe(1);
    // Fast again: the wait is now 14 s, so 7 s and 13 s are not enough.
    const early = feed(scaler, 16, UP_WAIT_MS + 100);
    expect(scaler.index).toBe(1);
    const rest = feed(scaler, 16, 8000);
    expect(scaler.index).toBe(0);
    expect(early + rest).toBeGreaterThanOrEqual(2 * UP_WAIT_MS);
  });

  it('keeps the normal wait when the step down comes over 3 s after an upgrade', () => {
    const scaler = new QualityScaler(1);
    feed(scaler, 16, UP_WAIT_MS + 100);
    expect(scaler.index).toBe(0);
    feed(scaler, 16, 3200);
    feed(scaler, 25, 2500);
    expect(scaler.index).toBe(1);
    expect(feed(scaler, 16, UP_WAIT_MS + 100)).toBeLessThan(UP_WAIT_MS + 100);
    expect(scaler.index).toBe(0);
  });

  it('ignores frames over 250 ms', () => {
    const scaler = new QualityScaler();
    for (let i = 0; i < 100; i++) scaler.sample(251);
    scaler.sample(1000);
    scaler.sample(Number.POSITIVE_INFINITY);
    expect(scaler.index).toBe(0);
    // An exactly-250 ms frame counts: five of them are 1.25 s of slow frames.
    for (let i = 0; i < 5; i++) scaler.sample(250);
    expect(scaler.index).toBe(1);
  });

  it('ignores negative and NaN frame times', () => {
    const scaler = new QualityScaler();
    for (let i = 0; i < 100; i++) scaler.sample(-30);
    scaler.sample(Number.NaN);
    expect(scaler.index).toBe(0);
  });

  describe('pin', () => {
    it('sets the level and stops adapting', () => {
      const scaler = new QualityScaler();
      scaler.pin(3);
      expect(scaler.index).toBe(3);
      for (let i = 0; i < 2000; i++) scaler.sample(8);
      expect(scaler.index).toBe(3);
    });

    it('holds a pinned high level under slow frames', () => {
      const scaler = new QualityScaler();
      scaler.pin(0);
      for (let i = 0; i < 500; i++) scaler.sample(40);
      expect(scaler.index).toBe(0);
    });

    it('rejects an unknown level with a fix', () => {
      expect(() => {
        new QualityScaler().pin(4);
      }).toThrow(/quality level.*0 to 3/i);
    });
  });
});
