import { describe, expect, it } from 'vitest';
import { interpolatePose, wrapCopies } from '../../src/render/interp';
import { WRAP_MARGIN } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';

const FIELD: Field = { width: 1000, height: 720 };
const PERIOD_X = FIELD.width + 2 * WRAP_MARGIN;
const PERIOD_Y = FIELD.height + 2 * WRAP_MARGIN;

function pose(px: number, py: number, pa: number, x: number, y: number, a: number, alpha: number) {
  const out = { x: 0, y: 0, angle: 0 };
  interpolatePose(px, py, pa, x, y, a, alpha, FIELD, out);
  return out;
}

describe('interpolatePose', () => {
  it('lerps position and angle between the previous and current pose', () => {
    const out = pose(100, 200, 0, 140, 160, 1, 0.25);
    expect(out.x).toBeCloseTo(110, 9);
    expect(out.y).toBeCloseTo(190, 9);
    expect(out.angle).toBeCloseTo(0.25, 9);
  });

  it('returns the previous pose at alpha 0 and the current pose at alpha 1', () => {
    expect(pose(10, 20, 0.5, 30, 40, 1.5, 0)).toEqual({ x: 10, y: 20, angle: 0.5 });
    expect(pose(10, 20, 0.5, 30, 40, 1.5, 1)).toEqual({ x: 30, y: 40, angle: 1.5 });
  });

  it('snaps to the current position when the entity wrapped horizontally', () => {
    const out = pose(FIELD.width + WRAP_MARGIN - 1, 300, 0, -WRAP_MARGIN + 1, 300, 0, 0.5);
    expect(out.x).toBe(-WRAP_MARGIN + 1);
    expect(out.y).toBe(300);
  });

  it('snaps to the current position when the entity wrapped vertically', () => {
    const out = pose(400, -WRAP_MARGIN + 1, 0, 400, FIELD.height + WRAP_MARGIN - 1, 0, 0.5);
    expect(out.y).toBe(FIELD.height + WRAP_MARGIN - 1);
  });

  it('keeps lerping at a displacement just under half the wrap period', () => {
    const out = pose(0, 0, 0, PERIOD_X / 2 - 1, 0, 0, 0.5);
    expect(out.x).toBeCloseTo((PERIOD_X / 2 - 1) / 2, 9);
    const snapped = pose(0, 0, 0, PERIOD_X / 2 + 1, 0, 0, 0.5);
    expect(snapped.x).toBe(PERIOD_X / 2 + 1);
  });

  it('turns the short way across plus or minus pi', () => {
    const out = pose(0, 0, 3, 0, 0, -3, 0.5);
    // Short arc from 3 to -3 is +0.283 rad through pi, not -6 rad through zero.
    expect(Math.abs(Math.abs(out.angle) - Math.PI)).toBeLessThan(1e-9);
    const quarter = pose(0, 0, -3, 0, 0, 3, 0.25);
    expect(quarter.angle).toBeCloseTo(-3 - 0.25 * (2 * Math.PI - 6), 9);
  });

  it('writes into the supplied object', () => {
    const out = { x: 0, y: 0, angle: 0 };
    interpolatePose(1, 2, 0, 3, 4, 0, 0.5, FIELD, out);
    expect(out).toEqual({ x: 2, y: 3, angle: 0 });
  });
});

describe('wrapCopies', () => {
  const out = new Float64Array(8);

  it('gives no copies in the interior', () => {
    expect(wrapCopies(500, 360, 60, FIELD, out)).toBe(0);
  });

  it('gives no copies for a small entity that is wholly off-field near the seam', () => {
    expect(wrapCopies(FIELD.width + 40, 360, 15, FIELD, out)).toBe(0);
  });

  it('gives one copy at minus the period at the right edge', () => {
    const count = wrapCopies(FIELD.width + 45, 360, 60, FIELD, out);
    expect(count).toBe(1);
    expect(out[0]).toBe(-PERIOD_X);
    expect(out[1]).toBe(0);
  });

  it('gives one copy at plus the period at the left edge', () => {
    const count = wrapCopies(-45, 360, 60, FIELD, out);
    expect(count).toBe(1);
    expect(out[0]).toBe(PERIOD_X);
    expect(out[1]).toBe(0);
  });

  it('gives one vertical copy at the top and bottom edges', () => {
    expect(wrapCopies(500, -45, 60, FIELD, out)).toBe(1);
    expect([out[0], out[1]]).toEqual([0, PERIOD_Y]);
    expect(wrapCopies(500, FIELD.height + 45, 60, FIELD, out)).toBe(1);
    expect([out[0], out[1]]).toEqual([0, -PERIOD_Y]);
  });

  it('gives three copies in a corner', () => {
    const count = wrapCopies(FIELD.width + 45, FIELD.height + 45, 60, FIELD, out);
    expect(count).toBe(3);
    const pairs = [0, 1, 2].map((i) => [out[i * 2], out[i * 2 + 1]]);
    expect(pairs).toContainEqual([-PERIOD_X, 0]);
    expect(pairs).toContainEqual([0, -PERIOD_Y]);
    expect(pairs).toContainEqual([-PERIOD_X, -PERIOD_Y]);
  });

  it('does not allocate: the caller buffer is written in place', () => {
    const buffer = new Float64Array(8);
    wrapCopies(-45, 360, 60, FIELD, buffer);
    expect(buffer[0]).toBe(PERIOD_X);
    expect(buffer.length).toBe(8);
  });

  it('draws every on-field point the entity will show after it wraps, with no useless copies', () => {
    const radius = 60;
    const buffer = new Float64Array(8);
    const steps = [-WRAP_MARGIN, -30, -1, 0, 1, 30, 60, 500];
    const xs = [...steps, ...steps.map((s) => FIELD.width - s)];
    const ys = [...steps, ...steps.map((s) => FIELD.height - s)];
    for (const x of xs) {
      for (const y of ys) {
        const count = wrapCopies(x, y, radius, FIELD, buffer);
        const drawn: [number, number][] = [[0, 0]];
        for (let i = 0; i < count; i++) drawn.push([buffer[i * 2] ?? NaN, buffer[i * 2 + 1] ?? NaN]);
        for (const kx of [-1, 0, 1]) {
          for (const ky of [-1, 0, 1]) {
            const dx = kx * PERIOD_X;
            const dy = ky * PERIOD_Y;
            const wasDrawn = drawn.some(([ox, oy]) => ox === dx && oy === dy);
            const boxVisible =
              x + dx + radius > 0 && x + dx - radius < FIELD.width && y + dy + radius > 0 && y + dy - radius < FIELD.height;
            if (kx === 0 && ky === 0) continue;
            let pointVisible = false;
            for (let a = 0; a < 64 && !pointVisible; a++) {
              for (const k of [0.25, 0.6, 1]) {
                const sx = x + dx + Math.cos((a / 64) * 2 * Math.PI) * radius * k;
                const sy = y + dy + Math.sin((a / 64) * 2 * Math.PI) * radius * k;
                if (sx >= 0 && sx <= FIELD.width && sy >= 0 && sy <= FIELD.height) pointVisible = true;
              }
            }
            if (pointVisible) expect(wasDrawn, `copy (${String(kx)},${String(ky)}) at ${String(x)},${String(y)}`).toBe(true);
            expect(wasDrawn).toBe(boxVisible);
          }
        }
      }
    }
  });
});
