import { describe, expect, it } from 'vitest';
import type { Field } from '../../src/sim/field';
import {
  AMBIENT_DRIFT_X,
  PARALLAX_FACTOR,
  createStarLayers,
  seedStars,
  stepStars,
  type Star,
} from '../../src/render/starfieldLayers';

const FIELD: Field = { width: 1000, height: 600 };

function star(x: number, y: number, z: number): Star {
  return { x, y, z, phase: 0, radius: 1 };
}

describe('stepStars', () => {
  it('moves stars opposite to ship velocity, proportional to depth', () => {
    const near = star(500, 300, 1);
    const far = star(500, 300, 0.25);
    stepStars([near, far], 1, 100, 50, FIELD);
    expect(near.x).toBeCloseTo(500 - 100 * PARALLAX_FACTOR + AMBIENT_DRIFT_X, 9);
    expect(near.y).toBeCloseTo(300 - 50 * PARALLAX_FACTOR, 9);
    expect(far.x - 500).toBeCloseTo((near.x - 500) * 0.25, 9);
    expect(far.y - 300).toBeCloseTo((near.y - 300) * 0.25, 9);
  });

  it('applies the slow ambient drift even when the ship is still', () => {
    const s = star(500, 300, 0.55);
    stepStars([s], 2, 0, 0, FIELD);
    expect(s.x).toBeCloseTo(500 + AMBIENT_DRIFT_X * 0.55 * 2, 9);
    expect(s.y).toBe(300);
  });

  it('wraps stars that leave the field on either side', () => {
    const left = star(0.5, 300, 1);
    const right = star(999.5, 300, 1);
    const top = star(500, 0.1, 1);
    const bottom = star(500, 599.9, 1);
    stepStars([left, right, top, bottom], 1, 5000, 5000, FIELD);
    for (const s of [left, right, top, bottom]) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(FIELD.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(FIELD.height);
    }
    const wrapped = star(2, 300, 1);
    stepStars([wrapped], 1, 0, 0, FIELD);
    expect(wrapped.x).toBeCloseTo(2 + AMBIENT_DRIFT_X + FIELD.width, 9);
  });
});

describe('seedStars', () => {
  it('is deterministic for a seed and places three depths inside the field', () => {
    const a = seedStars(7, 1, FIELD);
    const b = seedStars(7, 1, FIELD);
    expect(a).toEqual(b);
    expect(seedStars(8, 1, FIELD)).not.toEqual(a);
    expect(new Set(a.map((s) => s.z))).toEqual(new Set([0.25, 0.55, 1]));
    for (const s of a) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(FIELD.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(FIELD.height);
    }
  });

  it('scales the star count with countScale and sizes by depth', () => {
    const full = seedStars(7, 1, FIELD);
    const half = seedStars(7, 0.5, FIELD);
    expect(half.length).toBeLessThan(full.length);
    expect(half.length).toBeGreaterThan(0);
    const nearest = full.find((s) => s.z === 1);
    const farthest = full.find((s) => s.z === 0.25);
    expect(nearest?.radius).toBeGreaterThan(farthest?.radius ?? Infinity);
  });
});

describe('createStarLayers', () => {
  function recordingContext() {
    const calls = { arcs: 0, alphas: [] as number[] };
    const ctx = {
      globalAlpha: 1,
      fillStyle: '',
      beginPath: () => undefined,
      arc: () => {
        calls.arcs++;
        calls.alphas.push(ctx.globalAlpha);
      },
      fill: () => undefined,
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx };
  }

  it('draws one circle per star, twinkling in a bounded alpha range, and restores alpha', () => {
    const layers = createStarLayers(3, 1);
    layers.resize(FIELD);
    const { ctx, calls, raw } = recordingContext();
    layers.draw(ctx, 1.25, '#e8fdff');
    expect(calls.arcs).toBe(seedStars(3, 1, FIELD).length);
    for (const alpha of calls.alphas) {
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
    expect(raw.globalAlpha).toBe(1);
    expect(raw.fillStyle).toBe('#e8fdff');
  });

  it('draws nothing before resize and moves stars on step', () => {
    const layers = createStarLayers(3, 1);
    const empty = recordingContext();
    layers.draw(empty.ctx, 0, '#fff4ff');
    expect(empty.calls.arcs).toBe(0);
    layers.resize(FIELD);
    layers.step(0.016, 0, 0);
    const moved = recordingContext();
    layers.draw(moved.ctx, 0, '#fff4ff');
    expect(moved.calls.arcs).toBeGreaterThan(0);
  });
});

describe('createStarLayers.setCountScale', () => {
  const countFor = (setup: (layers: ReturnType<typeof createStarLayers>) => void): number => {
    let arcs = 0;
    const ctx = { beginPath: () => undefined, arc: () => arcs++, fill: () => undefined } as unknown as CanvasRenderingContext2D;
    const layers = createStarLayers(3, 1);
    layers.resize(FIELD);
    setup(layers);
    layers.draw(ctx, 0, '#fff4ff');
    return arcs;
  };

  it('drops to a smaller field of stars at once', () => {
    const full = countFor(() => undefined);
    const lowest = countFor((layers) => {
      layers.setCountScale(0.35);
    });
    expect(lowest).toBeLessThan(full * 0.5);
    expect(lowest).toBeGreaterThan(0);
  });

  it('applies to the next resize when called before one', () => {
    const layers = createStarLayers(3, 1);
    layers.setCountScale(0.5);
    let arcs = 0;
    layers.resize(FIELD);
    layers.draw({ beginPath: () => undefined, arc: () => arcs++, fill: () => undefined } as unknown as CanvasRenderingContext2D, 0, '#fff4ff');
    expect(arcs).toBe(seedStars(3, 0.5, FIELD).length);
  });

  /** Each drawn star as [x, y, radius], grouped by radius (one radius per layer). */
  const drawnLayers = (layers: ReturnType<typeof createStarLayers>): Map<number, number[][]> => {
    const byRadius = new Map<number, number[][]>();
    const arc = (x: number, y: number, r: number): void => {
      byRadius.set(r, [...(byRadius.get(r) ?? []), [x, y]]);
    };
    layers.draw({ beginPath: () => undefined, arc, fill: () => undefined } as unknown as CanvasRenderingContext2D, 0, '#fff4ff');
    return byRadius;
  };

  it('keeps the drifted stars of each layer that a lower count leaves', () => {
    const layers = createStarLayers(3, 1);
    layers.resize(FIELD);
    layers.step(1, 100, 40);
    const before = drawnLayers(layers);
    layers.setCountScale(0.5);
    const after = drawnLayers(layers);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [radius, stars] of after) {
      expect(stars.length).toBeLessThan(before.get(radius)?.length ?? 0);
      expect(stars).toEqual(before.get(radius)?.slice(0, stars.length));
    }
  });

  it('keeps every drifted star and adds new ones per layer on a higher count', () => {
    const layers = createStarLayers(3, 0.35);
    layers.resize(FIELD);
    layers.step(1, 100, 40);
    const before = drawnLayers(layers);
    layers.setCountScale(1);
    const after = drawnLayers(layers);
    for (const [radius, stars] of before) {
      const grown = after.get(radius) ?? [];
      expect(grown.length).toBeGreaterThan(stars.length);
      expect(grown.slice(0, stars.length)).toEqual(stars);
    }
    expect([...after.values()].flat()).toHaveLength(seedStars(3, 1, FIELD).length);
  });

  it('keeps the stars through a resize to the same size (a pixel ratio change) but reseeds a new size', () => {
    const layers = createStarLayers(3, 1);
    layers.resize(FIELD);
    layers.step(1, 100, 40);
    const before = drawnLayers(layers);
    layers.resize({ ...FIELD });
    expect(drawnLayers(layers)).toEqual(before);
    const wider = { width: 1200, height: 600 };
    layers.resize(wider);
    const xs = [...drawnLayers(layers).values()].flat().map(([x]) => x);
    expect(xs).toEqual(seedStars(3, 1, wider).map((star) => star.x));
  });

  it('keeps stars where they are when the scale does not change', () => {
    const layers = createStarLayers(3, 1);
    layers.resize(FIELD);
    layers.step(1, 100, 0);
    layers.setCountScale(1);
    const xs: number[] = [];
    layers.draw({ beginPath: () => undefined, arc: (x: number) => xs.push(x), fill: () => undefined } as unknown as CanvasRenderingContext2D, 0, '#fff4ff');
    expect(xs).not.toEqual(seedStars(3, 1, FIELD).map((s) => s.x));
  });
});
