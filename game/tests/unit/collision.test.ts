import { describe, expect, it } from 'vitest';
import { circlesOverlap, SpatialHash } from '../../src/sim/collision';
import { createRng, type Rng } from '../../src/sim/rng';

interface Circle {
  x: number;
  y: number;
  r: number;
}

const CELL = 128;
const SCENES = 200;
const CIRCLES_PER_SCENE = 60;
const QUERIES_PER_SCENE = 60;

function randomCircle(rng: Rng): Circle {
  return { x: rng.range(-100, 1800), y: rng.range(-100, 1800), r: rng.range(3, 60) };
}

function bruteForce(circles: readonly Circle[], q: Circle): number[] {
  const hits: number[] = [];
  circles.forEach((c, i) => {
    if (circlesOverlap(q.x, q.y, q.r, c.x, c.y, c.r)) {
      hits.push(i);
    }
  });
  return hits;
}

function hashed(hash: SpatialHash, circles: readonly Circle[], q: Circle): number[] {
  const hits: number[] = [];
  hash.forEachCandidate(q.x, q.y, q.r, (i) => {
    const c = circles[i];
    if (c && circlesOverlap(q.x, q.y, q.r, c.x, c.y, c.r)) {
      hits.push(i);
    }
  });
  return hits.sort((a, b) => a - b);
}

function candidates(hash: SpatialHash, x: number, y: number, r: number): number[] {
  const seen: number[] = [];
  hash.forEachCandidate(x, y, r, (i) => seen.push(i));
  return seen;
}

describe('circlesOverlap', () => {
  it('treats exactly touching circles as not overlapping', () => {
    expect(circlesOverlap(0, 0, 5, 10, 0, 5)).toBe(false);
    expect(circlesOverlap(0, 0, 3, 0, 5, 2)).toBe(false);
  });

  it('overlaps when 0.001 closer than touching', () => {
    expect(circlesOverlap(0, 0, 5, 9.999, 0, 5)).toBe(true);
  });

  it('does not overlap when apart', () => {
    expect(circlesOverlap(0, 0, 5, 100, 100, 5)).toBe(false);
  });
});

describe('SpatialHash', () => {
  it('finds exactly the brute-force overlaps across seeded scenes', () => {
    const hash = new SpatialHash(CELL);
    let totalHits = 0;
    for (let seed = 1; seed <= SCENES; seed++) {
      const rng = createRng(seed);
      const circles = Array.from({ length: CIRCLES_PER_SCENE }, () => randomCircle(rng));
      hash.clear();
      circles.forEach((c, i) => {
        hash.insert(i, c.x, c.y, c.r);
      });
      for (let k = 0; k < QUERIES_PER_SCENE; k++) {
        const q = randomCircle(rng);
        const expected = bruteForce(circles, q);
        totalHits += expected.length;
        expect(hashed(hash, circles, q)).toEqual(expected);
      }
    }
    expect(totalHits).toBeGreaterThan(100);
  });

  it('never visits the same index twice for one query', () => {
    const hash = new SpatialHash(CELL);
    const rng = createRng(77);
    const circles = Array.from({ length: 120 }, () => ({ ...randomCircle(rng), r: rng.range(40, 200) }));
    circles.forEach((c, i) => {
      hash.insert(i, c.x, c.y, c.r);
    });
    for (let k = 0; k < 100; k++) {
      const q = randomCircle(rng);
      const seen = candidates(hash, q.x, q.y, q.r * 4);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it('works across negative coordinates', () => {
    const hash = new SpatialHash(CELL);
    hash.insert(0, -1, -1, 3);
    hash.insert(1, 1, 1, 3);
    hash.insert(2, -300, -300, 10);
    expect(candidates(hash, 0, 0, 2).sort()).toEqual([0, 1]);
    expect(candidates(hash, -300, -300, 5)).toEqual([2]);
  });

  it('does not report items that are far away', () => {
    const hash = new SpatialHash(CELL);
    hash.insert(0, 1000, 1000, 5);
    expect(candidates(hash, 0, 0, 5)).toEqual([]);
  });

  it('forgets everything on clear and can be refilled', () => {
    const hash = new SpatialHash(CELL);
    hash.insert(0, 10, 10, 5);
    hash.clear();
    expect(candidates(hash, 10, 10, 5)).toEqual([]);
    hash.insert(1, 10, 10, 5);
    expect(candidates(hash, 10, 10, 5)).toEqual([1]);
  });

  it('still dedupes after repeated clear and refill cycles', () => {
    const hash = new SpatialHash(CELL);
    for (let frame = 0; frame < 50; frame++) {
      hash.clear();
      hash.insert(frame % 7, 500, 500, 200);
      expect(candidates(hash, 500, 500, 200)).toEqual([frame % 7]);
    }
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('rejects cell size %s', (size) => {
    expect(() => new SpatialHash(size)).toThrow(RangeError);
  });

  it('rejects non-finite circles with a RangeError', () => {
    const hash = new SpatialHash(CELL);
    expect(() => {
      hash.insert(0, Number.NaN, 0, 5);
    }).toThrow(RangeError);
    expect(() => {
      hash.forEachCandidate(0, 0, Number.POSITIVE_INFINITY, () => undefined);
    }).toThrow(RangeError);
  });
});
