import { describe, expect, it } from 'vitest';
import {
  createAsteroid,
  practiceSettings,
  spawnPracticeAsteroid,
  splitAsteroid,
  stepAsteroid,
  type Asteroid,
  type AsteroidSize,
} from '../../src/sim/asteroid';
import { ASTEROID, WRAP_MARGIN } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';

const FIELD: Field = { width: 1280, height: 720 };
const SIZES: readonly AsteroidSize[] = [0, 1, 2, 3];
const SEEDS = 1000;

function speedOf(a: Asteroid): number {
  return Math.hypot(a.vx, a.vy);
}

function isOnSpawnEdge(a: Asteroid): boolean {
  const margin = ASTEROID.spawnEdgeMargin;
  return a.x === -margin || a.x === FIELD.width + margin || a.y === -margin || a.y === FIELD.height + margin;
}

describe('createAsteroid', () => {
  it.each(SIZES)('size %i takes its radius from the table', (size) => {
    const a = createAsteroid(createRng(1), 10, 20, size, 0, 1);
    expect(a.radius).toBe(ASTEROID.radii[size]);
    expect(a.size).toBe(size);
    expect(a.x).toBe(10);
    expect(a.y).toBe(20);
  });

  it('keeps speed within the jitter band of base speed times multiplier', () => {
    const mult = 1.3;
    for (const size of SIZES) {
      const base = ASTEROID.baseSpeeds[size] * mult;
      for (let seed = 0; seed < SEEDS; seed++) {
        const speed = speedOf(createAsteroid(createRng(seed), 0, 0, size, 0.7, mult));
        expect(speed).toBeGreaterThanOrEqual(base * 0.8 - 1e-9);
        expect(speed).toBeLessThanOrEqual(base * 1.2 + 1e-9);
      }
    }
  });

  it('aims the velocity along the requested angle', () => {
    const a = createAsteroid(createRng(3), 0, 0, 1, Math.PI / 2, 1);
    expect(a.vx).toBeCloseTo(0, 9);
    expect(a.vy).toBeGreaterThan(0);
  });

  it('draws spin, rotation and vertices from the documented ranges', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const a = createAsteroid(createRng(seed), 0, 0, 0, 0, 1);
      expect(Math.abs(a.spin)).toBeLessThanOrEqual(ASTEROID.spinMax);
      expect(a.rotation).toBeGreaterThanOrEqual(0);
      expect(a.rotation).toBeLessThan(Math.PI * 2);
      expect(a.vertices.length).toBeGreaterThanOrEqual(7);
      expect(a.vertices.length).toBeLessThanOrEqual(11);
      for (const v of a.vertices) {
        const r = Math.hypot(v.x, v.y);
        expect(r).toBeGreaterThanOrEqual(a.radius * 0.7 - 1e-9);
        expect(r).toBeLessThanOrEqual(a.radius * 1.3 + 1e-9);
      }
    }
  });

  it('produces every vertex count from 7 to 11 across seeds', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      counts.add(createAsteroid(createRng(seed), 0, 0, 2, 0, 1).vertices.length);
    }
    expect([...counts].sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11]);
  });

  it('is deterministic for a given seed, vertices included', () => {
    const a = createAsteroid(createRng(42), 5, 6, 1, 1.1, 1.2);
    const b = createAsteroid(createRng(42), 5, 6, 1, 1.1, 1.2);
    expect(b).toEqual(a);
    expect(createAsteroid(createRng(43), 5, 6, 1, 1.1, 1.2)).not.toEqual(a);
  });
});

describe('stepAsteroid', () => {
  it('moves, spins and wraps past the margin', () => {
    const a = createAsteroid(createRng(5), 0, 0, 1, 0, 1);
    a.vx = 100;
    a.vy = -50;
    a.spin = 2;
    a.x = 10;
    a.y = 10;
    const rotation = a.rotation;
    stepAsteroid(a, 0.5, FIELD);
    expect(a.x).toBeCloseTo(60, 9);
    expect(a.y).toBeCloseTo(-15, 9);
    expect(a.rotation).toBeCloseTo(rotation + 1, 9);

    a.x = FIELD.width + WRAP_MARGIN - 1;
    a.vx = 100;
    a.vy = 0;
    stepAsteroid(a, 0.1, FIELD);
    expect(a.x).toBe(-WRAP_MARGIN);
  });
});

describe('splitAsteroid', () => {
  it.each([0, 1, 2] as const)('splits size %i into two children one size smaller at the parent position', (size) => {
    const rng = createRng(9);
    const parent = createAsteroid(rng, 30, 40, size, 0, 1);
    const kids = splitAsteroid(rng, parent);
    expect(kids).toHaveLength(2);
    for (const kid of kids) {
      expect(kid.size).toBe(size + 1);
      expect(kid.x).toBe(30);
      expect(kid.y).toBe(40);
      expect(kid.radius).toBe(ASTEROID.radii[kid.size]);
    }
  });

  it('does not split a tiny asteroid', () => {
    const rng = createRng(9);
    expect(splitAsteroid(rng, createAsteroid(rng, 0, 0, 3, 0, 1))).toEqual([]);
  });

  it('fans children within 0.75 rad of the parent rotation and speeds them up to 1.3x', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const rng = createRng(seed);
      const parent = createAsteroid(rng, 0, 0, 0, 0, 1);
      for (const kid of splitAsteroid(rng, parent)) {
        const heading = Math.atan2(kid.vy, kid.vx);
        const delta = Math.atan2(Math.sin(heading - parent.rotation), Math.cos(heading - parent.rotation));
        expect(Math.abs(delta)).toBeLessThanOrEqual(0.75 + 1e-9);
        const base = ASTEROID.baseSpeeds[1];
        expect(speedOf(kid)).toBeGreaterThanOrEqual(base * 0.8 - 1e-9);
        expect(speedOf(kid)).toBeLessThanOrEqual(base * 1.3 * 1.2 + 1e-9);
      }
    }
  });
});

describe('practiceSettings', () => {
  it('matches the live level 1 values', () => {
    const s = practiceSettings(1);
    expect(s.spawnInterval).toBeCloseTo(3.5, 9);
    expect(s.minAsteroids).toBe(3);
    expect(s.speedMultiplier).toBeCloseTo(1, 9);
  });

  it('matches the live level 7 values', () => {
    const s = practiceSettings(7);
    expect(s.spawnInterval).toBeCloseTo(1.7, 9);
    expect(s.minAsteroids).toBe(10);
    expect(s.speedMultiplier).toBeCloseTo(1.6, 9);
  });

  it('floors the spawn interval at half a second', () => {
    expect(practiceSettings(30).spawnInterval).toBe(0.5);
  });
});

describe('spawnPracticeAsteroid', () => {
  it('always spawns exactly 100 outside one edge', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const a = spawnPracticeAsteroid(createRng(seed), 1 + (seed % 7), FIELD, null, false);
      expect(isOnSpawnEdge(a)).toBe(true);
    }
  });

  it('keeps the flipped spawn exactly 100 outside an edge too', () => {
    const ship = createShip(FIELD.width / 2, FIELD.height / 2);
    for (let seed = 0; seed < SEEDS; seed++) {
      const a = spawnPracticeAsteroid(createRng(seed), 3, FIELD, ship, true);
      expect(isOnSpawnEdge(a)).toBe(true);
    }
  });

  it('never spawns within the safe radius of a centred ship when spawning away from it', () => {
    for (const field of [FIELD, { width: 960, height: 720 }, { width: 1680, height: 720 }]) {
      const ship = createShip(field.width / 2, field.height / 2);
      let closest = Infinity;
      for (let seed = 0; seed < SEEDS; seed++) {
        const a = spawnPracticeAsteroid(createRng(seed), 1 + (seed % 7), field, ship, true);
        const distance = Math.hypot(a.x - ship.x, a.y - ship.y);
        expect(distance).toBeGreaterThan(ASTEROID.safeRadius + a.radius);
        closest = Math.min(closest, distance - (ASTEROID.safeRadius + a.radius));
      }
      expect(closest).toBeGreaterThan(0);
    }
  });

  it('flips a spawn that lands near an off-centre ship to the opposite edge', () => {
    const margin = ASTEROID.spawnEdgeMargin;
    const ship = createShip(FIELD.width / 2, -margin + 20);
    let flipped = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const a = spawnPracticeAsteroid(createRng(seed), 1, FIELD, ship, true);
      if (a.y === FIELD.height + margin) {
        flipped++;
      }
      if (a.y === -margin) {
        expect(Math.hypot(a.x - ship.x, a.y - ship.y)).toBeGreaterThanOrEqual(80 + ASTEROID.safeRadius);
      }
    }
    expect(flipped).toBeGreaterThan(0);
  });

  it('ignores awayFromShip when there is no ship', () => {
    const a = spawnPracticeAsteroid(createRng(7), 1, FIELD, null, true);
    const b = spawnPracticeAsteroid(createRng(7), 1, FIELD, null, false);
    expect(a).toEqual(b);
  });

  it('spawns only tiny asteroids on level 1', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(spawnPracticeAsteroid(createRng(seed), 1, FIELD, null, false).size).toBe(3);
    }
  });

  it('introduces larger sizes as the level rises', () => {
    const sizesAt = (level: number): Set<number> => {
      const sizes = new Set<number>();
      for (let seed = 0; seed < SEEDS; seed++) {
        sizes.add(spawnPracticeAsteroid(createRng(seed), level, FIELD, null, false).size);
      }
      return sizes;
    };
    expect(sizesAt(2)).toEqual(new Set([2, 3]));
    expect(sizesAt(4)).toEqual(new Set([1, 2, 3]));
    expect(sizesAt(6)).toEqual(new Set([0, 1, 2, 3]));
  });

  it('aims the spawn into the field and scales speed with level', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const a = spawnPracticeAsteroid(createRng(seed), 7, FIELD, null, false);
      const base = ASTEROID.baseSpeeds[a.size] * 1.6;
      expect(speedOf(a)).toBeGreaterThanOrEqual(base * 0.8 - 1e-9);
      expect(speedOf(a)).toBeLessThanOrEqual(base * 1.2 + 1e-9);
    }
  });

  it('is deterministic for a given seed', () => {
    const ship = createShip(640, 360);
    const a = spawnPracticeAsteroid(createRng(11), 6, FIELD, ship, true);
    const b = spawnPracticeAsteroid(createRng(11), 6, FIELD, ship, true);
    expect(b).toEqual(a);
  });
});
