import { describe, expect, it } from 'vitest';
import { PICKUP_IDS } from '../../src/content/pickups';
import { drawGlyph, expiryAlpha, PICKUP_COLORS } from '../../src/render/pickupArt';
import { PICKUP } from '../../src/sim/config';
import { recordingContext } from '../helpers/fakeCanvas';

/** A Canvas 2D stand-in that names every call made on it. */
function namingContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const ctx = recordingContext({ call: (name) => calls.push(name) }) as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('expiryAlpha', () => {
  it('is whole until the last 2 s', () => {
    for (const left of [8, 5, 2.01]) expect(expiryAlpha(left, false)).toBe(1);
    expect(PICKUP.blinkSeconds).toBe(2);
  });

  it('blinks at 4 Hz through the last 2 s, between whole and dim', () => {
    const steps = 160;
    const seen: number[] = [];
    for (let i = 0; i < steps; i++) seen.push(expiryAlpha(2 - (2 * i) / steps - 1e-9, false));
    const flips = seen.filter((alpha, i) => i > 0 && alpha !== seen[i - 1]).length;
    // 4 blinks a second for 2 s: 16 halves, 15 changes between them.
    expect(flips).toBe(15);
    expect(new Set(seen).size).toBe(2);
    expect(Math.min(...seen)).toBeGreaterThan(0);
  });

  it('holds a steady dim under reduced motion instead of blinking', () => {
    const still = [1.9, 1.3, 0.7, 0.1].map((left) => expiryAlpha(left, true));
    expect(new Set(still).size).toBe(1);
    expect(still[0]).toBeLessThan(1);
    expect(still[0]).toBeGreaterThan(0);
  });
});

describe('drawGlyph', () => {
  it('draws every pickup from canvas paths alone, never text', () => {
    for (const kind of PICKUP_IDS) {
      const { ctx, calls } = namingContext();
      drawGlyph(ctx, kind, 0, 0, 10, PICKUP_COLORS[kind]);
      expect(calls.some((name) => name === 'fill' || name === 'stroke'), kind).toBe(true);
      expect(calls.filter((name) => name.endsWith('Text'))).toEqual([]);
    }
  });

  it('draws Crimson Nebula\'s two by shape and stroke alike: a lance through a ring, and a dart at the end of its curving trail', () => {
    for (const kind of ['piercingBeam', 'homingMissiles'] as const) {
      const { ctx, calls } = namingContext();
      drawGlyph(ctx, kind, 0, 0, 10, PICKUP_COLORS[kind]);
      expect(calls.filter((name) => name === 'stroke'), kind).toHaveLength(1);
      expect(calls.filter((name) => name === 'fill'), kind).toHaveLength(1);
    }
    const { ctx, calls } = namingContext();
    drawGlyph(ctx, 'homingMissiles', 0, 0, 10, PICKUP_COLORS.homingMissiles);
    expect(calls).toContain('quadraticCurveTo');
  });

  it('gives every pickup a colour of its own', () => {
    expect(new Set(PICKUP_IDS.map((kind) => PICKUP_COLORS[kind])).size).toBe(PICKUP_IDS.length);
  });
});
