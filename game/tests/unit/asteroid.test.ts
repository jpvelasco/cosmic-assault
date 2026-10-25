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
import { ASTEROID, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { createRng } from '../../src/sim/rng';
import { createShip, type Ship } from '../../src/sim/ship';

const FIELD: Field = { width: 1280, height: 720 };
/** The narrowest, the e2e desktop and the widest field. */
const FIELDS: readonly Field[] = [{ width: 960, height: 720 }, FIELD, { width: 1680, height: 720 }];
const SIZES: readonly AsteroidSize[] = [0, 1, 2, 3];
const SEEDS = 1000;
/** Live `circleCollision(x, y, 80, ship.x, ship.y, 150)`: a spawn this close to the ship is flipped. */
const FLIP_REACH = 80 + ASTEROID.safeRadius;

type Edge = 0 | 1 | 2 | 3;
const OPPOSITE: Readonly<Record<Edge, Edge>> = { 0: 2, 1: 3, 2: 0, 3: 1 };

function speedOf(a: Asteroid): number {
  return Math.hypot(a.vx, a.vy);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The edge (0 top, 1 right, 2 bottom, 3 left) whose wrap line the asteroid sits on, or null. */
function edgeOf(a: Asteroid, field: Field): Edge | null {
  if (a.y === -WRAP_MARGIN) return 0;
  if (a.x === field.width + WRAP_MARGIN) return 1;
  if (a.y === field.height + WRAP_MARGIN) return 2;
  if (a.x === -WRAP_MARGIN) return 3;
  return null;
}

/** The coordinate along the spawn edge: x on the top and bottom edges, y on the sides. */
function alongEdge(a: Asteroid, edge: Edge): number {
  return edge % 2 === 0 ? a.x : a.y;
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
  it('always spawns exactly on the wrap line outside one edge, flipped or not', () => {
    const ship = createShip(FIELD.width / 2, FIELD.height / 2);
    for (let seed = 0; seed < SEEDS; seed++) {
      const level = 1 + (seed % 7);
      expect(edgeOf(spawnPracticeAsteroid(createRng(seed), level, FIELD, null, false), FIELD)).not.toBeNull();
      expect(edgeOf(spawnPracticeAsteroid(createRng(seed), level, FIELD, ship, true), FIELD)).not.toBeNull();
    }
  });

  it('enters without a wrap jump and clears the ship, wherever the ship is', () => {
    // A spawn this close to the ship is flipped to the opposite edge, which is then always clear:
    // the two edges are H + 100 or W + 100 apart, more than twice the reach, so no ship position
    // (wrap band included) is within reach of both and no "best of two bad edges" case exists.
    expect(2 * FLIP_REACH).toBeLessThan(Math.min(...FIELDS.map((f) => f.height)) + 2 * WRAP_MARGIN);
    const shipRng = createRng(12345);
    let spawns = 0;
    for (const field of FIELDS) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const ship = createShip(
          shipRng.range(-WRAP_MARGIN, field.width + WRAP_MARGIN),
          shipRng.range(-WRAP_MARGIN, field.height + WRAP_MARGIN),
        );
        for (const awayFromShip of [true, false]) {
          const a = spawnPracticeAsteroid(createRng(seed), 1 + (seed % 7), field, ship, awayFromShip);
          if (awayFromShip) expect(distance(a, ship)).toBeGreaterThanOrEqual(ASTEROID.safeRadius + a.radius);
          const maxStep = speedOf(a) * STEP_SECONDS * 1.01;
          for (let i = 0; i < 3; i++) {
            const before = { x: a.x, y: a.y };
            stepAsteroid(a, STEP_SECONDS, field);
            expect(distance(a, before)).toBeLessThanOrEqual(maxStep);
          }
          spawns++;
        }
      }
    }
    expect(spawns).toBeGreaterThanOrEqual(2000);
  });

  it('mirrors a spawn whose aim jitter points back out through its edge', () => {
    // Seed 1 at 21:9 aims 0.067 rad from the bottom-left corner: down and out, past the wrap line.
    const wide = { width: 1680, height: 720 };
    const a = spawnPracticeAsteroid(createRng(1), 2, wide, null, false);
    expect(edgeOf(a, wide)).toBe(2);
    expect(a.vy).toBeLessThan(0);
    expect(Math.atan2(-a.vy, a.vx)).toBeCloseTo(0.067, 3);
  });

  it.each<[string, Edge, (f: Field) => { x: number; y: number }]>([
    ['top', 0, (f) => ({ x: f.width / 2, y: 0 })],
    ['right', 1, (f) => ({ x: f.width, y: f.height / 2 })],
    ['bottom', 2, (f) => ({ x: f.width / 2, y: f.height })],
    ['left', 3, (f) => ({ x: 0, y: f.height / 2 })],
  ])('flips a spawn near a ship by the %s edge to the opposite edge', (_name, edge, at) => {
    const { x, y } = at(FIELD);
    const ship: Ship = createShip(x, y);
    let flipped = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const unflipped = spawnPracticeAsteroid(createRng(seed), 1, FIELD, ship, false);
      const a = spawnPracticeAsteroid(createRng(seed), 1, FIELD, ship, true);
      if (edgeOf(unflipped, FIELD) === edge && distance(unflipped, ship) < FLIP_REACH) {
        flipped++;
        expect(edgeOf(a, FIELD)).toBe(OPPOSITE[edge]);
        expect(alongEdge(a, OPPOSITE[edge])).toBe(alongEdge(unflipped, edge));
        expect(distance(a, ship)).toBeGreaterThanOrEqual(FLIP_REACH);
      } else {
        expect(a).toEqual(unflipped);
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

  it('scales speed with level', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const a = spawnPracticeAsteroid(createRng(seed), 7, FIELD, null, false);
      const base = ASTEROID.baseSpeeds[a.size] * 1.6;
      expect(speedOf(a)).toBeGreaterThanOrEqual(base * 0.8 - 1e-9);
      expect(speedOf(a)).toBeLessThanOrEqual(base * 1.2 + 1e-9);
    }
  });

  it('heads within 0.4 rad of the [0.3, 0.7] target box seen from the spawn point', () => {
    const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
    for (const field of FIELDS) {
      const corners = [0.3, 0.7].flatMap((fx) => [0.3, 0.7].map((fy) => ({ x: field.width * fx, y: field.height * fy })));
      for (let seed = 0; seed < SEEDS; seed++) {
        const a = spawnPracticeAsteroid(createRng(seed), 1 + (seed % 7), field, null, false);
        const centre = Math.atan2(field.height / 2 - a.y, field.width / 2 - a.x);
        const offsets = corners.map((c) => wrapAngle(Math.atan2(c.y - a.y, c.x - a.x) - centre));
        const heading = wrapAngle(Math.atan2(a.vy, a.vx) - centre);
        expect(heading).toBeGreaterThanOrEqual(Math.min(...offsets) - 0.4 - 1e-9);
        expect(heading).toBeLessThanOrEqual(Math.max(...offsets) + 0.4 + 1e-9);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const ship = createShip(640, 360);
    const a = spawnPracticeAsteroid(createRng(11), 6, FIELD, ship, true);
    const b = spawnPracticeAsteroid(createRng(11), 6, FIELD, ship, true);
    expect(b).toEqual(a);
  });
});

describe('shape randomness', () => {
  function gameplayOf(a: Asteroid): Omit<Asteroid, 'vertices'> {
    return { x: a.x, y: a.y, vx: a.vx, vy: a.vy, rotation: a.rotation, spin: a.spin, size: a.size, radius: a.radius };
  }

  function expectShapeOnlyDiffers(make: (shapeSeed: number) => readonly Asteroid[]): void {
    const a = make(100);
    const b = make(200);
    expect(a.length).toBeGreaterThan(0);
    expect(b.map(gameplayOf)).toEqual(a.map(gameplayOf));
    expect(b.map((x) => x.vertices)).not.toEqual(a.map((x) => x.vertices));
    expect(make(100)).toEqual(a);
  }

  it('createAsteroid draws only vertices from shapeRng', () => {
    expectShapeOnlyDiffers((shapeSeed) => [createAsteroid(createRng(1), 5, 6, 1, 0.4, 1.1, createRng(shapeSeed))]);
  });

  it('createAsteroid keeps vertices fixed when only the gameplay rng changes', () => {
    const shape = (seed: number) => createAsteroid(createRng(seed), 0, 0, 2, 0, 1, createRng(9)).vertices;
    expect(shape(2)).toEqual(shape(1));
  });

  it('splitAsteroid passes shapeRng to the children', () => {
    const parent = createAsteroid(createRng(3), 30, 40, 0, 0, 1);
    expectShapeOnlyDiffers((shapeSeed) => splitAsteroid(createRng(4), parent, createRng(shapeSeed)));
  });

  it('spawnPracticeAsteroid passes shapeRng to the new asteroid', () => {
    expectShapeOnlyDiffers((shapeSeed) => [
      spawnPracticeAsteroid(createRng(5), 6, FIELD, null, false, createRng(shapeSeed)),
    ]);
  });
});
