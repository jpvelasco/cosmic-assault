import { describe, expect, it } from 'vitest';
import { DRONE_TURN_RATE, FOES, FRAGMENT_SPEED_MULTIPLIER, SPLITTER_FRAGMENTS } from '../../src/content/foes';
import { ASTEROID, MAX_ASPECT, MIN_ASPECT, FIELD_HEIGHT, PLAYER, PROJECTILE, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { FoePool } from '../../src/sim/foes/foe';
import { FOE_CAPACITY, FoeField, type FoeHooks } from '../../src/sim/foes/foeField';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import { wrapDelta } from '../../src/sim/wrap';
import { ofType, stubArena, type StubArena } from '../helpers/bossArena';

const FIELD_43: Field = { width: FIELD_HEIGHT * MIN_ASPECT, height: FIELD_HEIGHT };
const FIELD_219: Field = { width: FIELD_HEIGHT * MAX_ASPECT, height: FIELD_HEIGHT };
const DT = STEP_SECONDS;

interface Rig {
  readonly arena: StubArena;
  readonly foes: FoeField;
  readonly awarded: number[];
  readonly killed: { x: number; y: number }[];
}

/** A foe field on a stub arena whose ship sits at (shipX, shipY); a kill is scored at `multiplier` times its base. */
function rig(opts: { seed?: number; field?: Field; shipX?: number; shipY?: number; multiplier?: number } = {}): Rig {
  const { seed = 1, field = FIELD_43, shipX = field.width / 2, shipY = field.height / 2, multiplier = 1 } = opts;
  const base = stubArena(createShip(shipX, shipY), field);
  const awarded: number[] = [];
  const arena: StubArena = { ...base, award: (points) => awarded.push(points) };
  const killed: { x: number; y: number }[] = [];
  const hooks: FoeHooks = { score: (points) => points * multiplier, killed: (x, y) => killed.push({ x, y }) };
  return { arena, foes: new FoeField(arena, createRng(seed), hooks), awarded, killed };
}

describe('FoePool', () => {
  it('hands out its foes and reuses them once swept, allocating no new object', () => {
    const pool = new FoePool(2);
    const a = pool.acquire('drone', 1);
    const b = pool.acquire('splitter', 2);
    expect(a).not.toBeNull();
    expect(pool.acquire('drone', 3)).toBeNull();
    if (a === null || b === null) return;
    pool.add(a);
    pool.add(b);
    expect(pool.live).toEqual([a, b]);
    a.hp = 0;
    pool.sweep();
    expect(pool.live).toEqual([b]);
    const again = pool.acquire('splitter', 4);
    expect(again).toBe(a);
    expect(again).toMatchObject({ id: 4, kind: 'splitter', radius: 30, hp: 2 });
  });

  it('gives each kind its radius and HP from content, and a clean slate on reuse', () => {
    const pool = new FoePool(1);
    const drone = pool.acquire('drone', 1);
    if (drone === null) throw new Error('pool should have a foe');
    expect(drone).toMatchObject({ radius: FOES.drone.radius, hp: 1 });
    drone.vx = 5;
    drone.spin = 3;
    pool.add(drone);
    pool.clear();
    expect(pool.live).toEqual([]);
    expect(pool.acquire('splitter', 2)).toMatchObject({ vx: 0, spin: 0, radius: 30, hp: 2 });
  });

  it('weighs what is on the field by each foe\'s content cost', () => {
    const pool = new FoePool(3);
    for (const kind of ['splitter', 'drone', 'drone'] as const) {
      const foe = pool.acquire(kind, 1);
      if (foe !== null) pool.add(foe);
    }
    expect(pool.cost).toBe(3 + 1 + 1);
  });
});

describe('splitter', () => {
  function withSplitter(opts: Parameters<typeof rig>[0] = {}) {
    const r = rig(opts);
    r.foes.spawn('splitter', 1, 1);
    const foe = r.foes.list[0];
    if (foe === undefined) throw new Error('a splitter should have arrived');
    return { ...r, foe };
  }

  it('arrives alone at an edge, announced, with radius 30 and 2 HP, heading into the field', () => {
    const { arena, foes, foe } = withSplitter();
    expect(foes.list).toHaveLength(1);
    expect(foe).toMatchObject({ kind: 'splitter', radius: 30, hp: 2 });
    expect(ofType(arena.events, 'foeSpawned')).toEqual([{ type: 'foeSpawned', id: foe.id, kind: 'splitter', x: foe.x, y: foe.y }]);
    const onEdge = foe.x === -WRAP_MARGIN || foe.x === FIELD_43.width + WRAP_MARGIN || foe.y === -WRAP_MARGIN || foe.y === FIELD_43.height + WRAP_MARGIN;
    expect(onEdge).toBe(true);
    const inward = (foe.x - FIELD_43.width / 2) * foe.vx + (foe.y - FIELD_43.height / 2) * foe.vy;
    expect(inward).toBeLessThan(0);
    expect(foe.px).toBe(foe.x);
  });

  it('drifts at rock speed and wraps like a rock', () => {
    const { foes, foe } = withSplitter();
    const speed = Math.hypot(foe.vx, foe.vy);
    expect(speed).toBeGreaterThanOrEqual(FOES.splitter.speed * ASTEROID.speedJitter[0]);
    expect(speed).toBeLessThanOrEqual(FOES.splitter.speed * ASTEROID.speedJitter[1]);
    foe.x = FIELD_43.width + WRAP_MARGIN - 0.01;
    foe.vx = 100;
    foe.vy = 0;
    foes.step(DT);
    expect(foe.x).toBe(-WRAP_MARGIN);
  });

  it('takes two hits: the first leaves it alive with 1 HP and scores nothing', () => {
    const { arena, foes, foe, awarded, killed } = withSplitter();
    arena.events.length = 0;
    foes.step(DT);
    expect(foes.hit(foe.x, foe.y, PROJECTILE.radius)).toBe(true);
    expect(ofType(arena.events, 'foeHit')).toEqual([{ type: 'foeHit', id: foe.id, x: foe.x, y: foe.y, hp: 1 }]);
    expect(ofType(arena.events, 'foeDestroyed')).toEqual([]);
    expect(awarded).toEqual([]);
    expect(killed).toEqual([]);
    foes.sweep();
    expect(foes.list).toEqual([foe]);
  });

  it('breaks into three tiny, transient fragments at 1.6x tiny speed, scoring 100 and counting the kill', () => {
    const { arena, foes, foe, awarded, killed } = withSplitter({ multiplier: 2 });
    foes.step(DT);
    arena.events.length = 0;
    foes.hit(foe.x, foe.y, PROJECTILE.radius);
    const { x, y } = foe;
    foes.hit(foe.x, foe.y, PROJECTILE.radius);
    expect(ofType(arena.events, 'foeDestroyed')).toEqual([{ type: 'foeDestroyed', id: foe.id, kind: 'splitter', x, y, points: 200 }]);
    expect(awarded).toEqual([200]);
    expect(killed).toEqual([{ x, y }]);
    expect(arena.asteroids).toHaveLength(SPLITTER_FRAGMENTS);
    const [low, high] = ASTEROID.speedJitter;
    for (const fragment of arena.asteroids) {
      expect(fragment).toMatchObject({ size: 3, radius: ASTEROID.radii[3], transient: true, x, y });
      const speed = Math.hypot(fragment.vx, fragment.vy);
      expect(speed).toBeGreaterThanOrEqual(ASTEROID.baseSpeeds[3] * FRAGMENT_SPEED_MULTIPLIER * low - 1e-9);
      expect(speed).toBeLessThanOrEqual(ASTEROID.baseSpeeds[3] * FRAGMENT_SPEED_MULTIPLIER * high + 1e-9);
    }
    expect(new Set(arena.asteroids.map((a) => a.id)).size).toBe(3);
    foes.sweep();
    expect(foes.list).toEqual([]);
  });

  it('lets more shots in the same step pass on once it is dead: one score, one kill, one set of fragments, one pickup roll', () => {
    const { arena, foes, foe, awarded, killed } = withSplitter();
    foes.step(DT);
    foes.hit(foe.x, foe.y, PROJECTILE.radius);
    expect(foes.hit(foe.x, foe.y, PROJECTILE.radius)).toBe(true);
    // The dead splitter is still listed until the step's sweep, but it can no longer be hit.
    expect(foes.list).toContain(foe);
    expect(foes.hit(foe.x, foe.y, PROJECTILE.radius)).toBe(false);
    expect(foes.hit(foe.x, foe.y, PROJECTILE.radius)).toBe(false);
    expect(ofType(arena.events, 'foeDestroyed')).toHaveLength(1);
    expect(awarded).toHaveLength(1);
    expect(killed).toHaveLength(1);
    expect(arena.asteroids).toHaveLength(SPLITTER_FRAGMENTS);
    expect(foes.ram(foe.x, foe.y, PLAYER.radius)).toBe(false);
  });

  it('brings in as many as asked for, each announced', () => {
    const r = rig();
    r.foes.spawn('splitter', 3, 1);
    expect(r.foes.list).toHaveLength(3);
    expect(ofType(r.arena.events, 'foeSpawned')).toHaveLength(3);
  });

  it('fans its fragments evenly round the circle', () => {
    const { foes, foe, arena } = withSplitter();
    foes.step(DT);
    foes.hit(foe.x, foe.y, PROJECTILE.radius);
    foes.hit(foe.x, foe.y, PROJECTILE.radius);
    const headings = arena.asteroids.map((a) => Math.atan2(a.vy, a.vx)).sort((a, b) => a - b);
    expect(headings).toHaveLength(3);
    const gaps = headings.map((heading, i) => (headings[(i + 1) % 3] ?? 0) - heading + (i === 2 ? 2 * Math.PI : 0));
    for (const gap of gaps) expect(gap).toBeCloseTo((2 * Math.PI) / 3, 10);
  });

  it('is rammed by the ship for 0 points, still leaving its fragments, and drops no pickup', () => {
    const { arena, foes, foe, awarded, killed } = withSplitter();
    foes.step(DT);
    arena.events.length = 0;
    expect(foes.ram(foe.x, foe.y, PLAYER.radius)).toBe(true);
    expect(ofType(arena.events, 'foeDestroyed')).toMatchObject([{ id: foe.id, points: 0 }]);
    expect(awarded).toEqual([]);
    expect(killed).toEqual([]);
    expect(arena.asteroids).toHaveLength(SPLITTER_FRAGMENTS);
    foes.sweep();
    expect(foes.list).toEqual([]);
  });

  it('misses a shot just outside its radius and hits one just inside', () => {
    const { foes, foe } = withSplitter();
    foes.step(DT);
    expect(foes.hit(foe.x + foe.radius + PROJECTILE.radius + 0.5, foe.y, PROJECTILE.radius)).toBe(false);
    expect(foes.hit(foe.x + foe.radius + PROJECTILE.radius - 0.5, foe.y, PROJECTILE.radius)).toBe(true);
  });
});

describe('drone', () => {
  const SAFE = ASTEROID.safeRadius;

  it('arrives in a group of the size asked for, at one edge, each announced', () => {
    const r = rig({ shipX: 300, shipY: 300 });
    r.foes.spawn('drone', 4, 1);
    expect(r.foes.list).toHaveLength(4);
    expect(ofType(r.arena.events, 'foeSpawned')).toHaveLength(4);
    const edges = new Set(r.foes.list.map((d) => (d.x === -WRAP_MARGIN ? 'l' : d.x === FIELD_43.width + WRAP_MARGIN ? 'r' : d.y === -WRAP_MARGIN ? 't' : 'b')));
    expect(edges.size).toBe(1);
    for (const d of r.foes.list) expect(d).toMatchObject({ kind: 'drone', hp: 1, radius: FOES.drone.radius });
  });

  it('flies at 120 units a second, from the first step to the last', () => {
    const r = rig({ shipX: 600, shipY: 360 });
    r.foes.spawn('drone', 3, 1);
    for (let i = 0; i < 400; i++) {
      r.foes.step(DT);
      for (const d of r.foes.list) expect(Math.hypot(d.vx, d.vy)).toBeCloseTo(FOES.drone.speed, 9);
    }
  });

  it('turns toward the ship by at most 2.2 rad/s', () => {
    const r = rig({ shipX: 600, shipY: 360 });
    r.foes.spawn('drone', 1, 1);
    const drone = r.foes.list[0];
    if (drone === undefined) throw new Error('a drone should have arrived');
    // Put the ship straight behind it, so it must turn half a circle.
    drone.x = 600;
    drone.y = 100;
    drone.rotation = -Math.PI / 2;
    let previous = drone.rotation;
    let turned = 0;
    for (let i = 0; i < 120; i++) {
      r.foes.step(DT);
      const turn = Math.abs(drone.rotation - previous);
      expect(turn).toBeLessThanOrEqual(DRONE_TURN_RATE * DT + 1e-12);
      turned += turn;
      previous = drone.rotation;
    }
    // A full second of turning at the limit.
    expect(turned).toBeCloseTo(DRONE_TURN_RATE, 6);
  });

  it('turns the short way round, whichever side the ship is on', () => {
    for (const shipX of [400, 800]) {
      const r = rig({ shipX, shipY: 360 });
      r.foes.spawn('drone', 1, 1);
      const drone = r.foes.list[0];
      if (drone === undefined) throw new Error('a drone should have arrived');
      drone.x = 600;
      drone.y = 360;
      drone.rotation = -Math.PI / 2 + 0.1;
      r.foes.step(DT);
      const wanted = shipX < 600 ? Math.PI : 0;
      const before = Math.abs(((wanted - (-Math.PI / 2 + 0.1) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      const after = Math.abs(((wanted - drone.rotation + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(after).toBeLessThan(before);
    }
  });

  it('closes on a ship that stands still, and a hunting swarm runs into it', () => {
    const r = rig({ shipX: 640, shipY: 360 });
    r.foes.spawn('drone', 3, 1);
    let rammed = false;
    for (let i = 0; i < 20 * 120 && !rammed; i++) {
      r.foes.step(DT);
      rammed = r.foes.ram(640, 360, PLAYER.radius);
    }
    expect(rammed).toBe(true);
  });

  it('dies to one hit, scoring 100 and counting the kill', () => {
    const r = rig({ multiplier: 3 });
    r.foes.spawn('drone', 3, 1);
    r.foes.step(DT);
    const drone = r.foes.list[1];
    if (drone === undefined) throw new Error('a drone should have arrived');
    r.arena.events.length = 0;
    expect(r.foes.hit(drone.x, drone.y, PROJECTILE.radius)).toBe(true);
    expect(ofType(r.arena.events, 'foeDestroyed')).toEqual([{ type: 'foeDestroyed', id: drone.id, kind: 'drone', x: drone.x, y: drone.y, points: 300 }]);
    expect(r.awarded).toEqual([300]);
    expect(r.killed).toHaveLength(1);
    expect(r.arena.asteroids).toEqual([]);
    r.foes.sweep();
    expect(r.foes.list).toHaveLength(2);
  });

  it('keeps a swarm of 5 chasing a circling ship at least 16 units apart once 2 s have passed (Ruling R14)', () => {
    const r = rig({ field: FIELD_43, shipX: 820, shipY: 360 });
    r.foes.spawn('drone', 5, 1);
    const drones = r.foes.list;
    expect(drones).toHaveLength(5);
    const { ship } = r.arena;
    let closest = Infinity;
    for (let i = 1; i <= 8 / DT; i++) {
      const angle = i * DT * 1.2;
      ship.x = 640 + Math.cos(angle) * 180;
      ship.y = 360 + Math.sin(angle) * 180;
      r.foes.step(DT);
      if (i * DT < 2) continue;
      for (const [j, a] of drones.entries()) for (const b of drones.slice(j + 1)) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      for (const d of drones) expect(Math.hypot(d.vx, d.vy)).toBeCloseTo(FOES.drone.speed, 9);
    }
    expect(closest).toBeGreaterThanOrEqual(16);
  });

  it('keeps apart from a drone just across the wrap edge, as from one beside it', () => {
    // Two drones either side of the left and right edges, 4 units apart through the wrap; the ship straight below both.
    const r = rig({ field: FIELD_43, shipX: 0, shipY: 700 });
    r.foes.spawn('drone', 2, 1);
    const [a, b] = r.foes.list;
    if (a === undefined || b === undefined) throw new Error('two drones should have arrived');
    Object.assign(a, { x: -WRAP_MARGIN + 2, y: 300, rotation: Math.PI / 2 });
    Object.assign(b, { x: FIELD_43.width + WRAP_MARGIN - 2, y: 300, rotation: Math.PI / 2 });
    r.arena.ship.x = a.x;
    r.foes.step(DT);
    // Each turns away from the other: a toward +x (into the field), b toward −x.
    expect(Math.cos(a.rotation)).toBeGreaterThan(1e-6);
    expect(Math.cos(b.rotation)).toBeLessThan(-1e-6);
  });

  it('spends one shot on one drone even where two overlap', () => {
    const r = rig();
    r.foes.spawn('drone', 3, 1);
    const [a, b] = r.foes.list;
    if (a === undefined || b === undefined) throw new Error('drones should have arrived');
    b.x = a.x;
    b.y = a.y;
    r.foes.step(DT);
    r.foes.hit(a.x, a.y, PROJECTILE.radius);
    r.foes.sweep();
    expect(r.foes.list).toHaveLength(2);
  });

  describe.each([
    ['4:3', FIELD_43],
    ['21:9', FIELD_219],
  ])('spawn safety at %s (Review Focus 3)', (_name, field) => {
    /** A grid of ship places across the field and the wrap margin round it, with every seed in a range. */
    const ships: (readonly [number, number])[] = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) ships.push([-WRAP_MARGIN + (i / 12) * (field.width + 2 * WRAP_MARGIN), -WRAP_MARGIN + (j / 8) * (field.height + 2 * WRAP_MARGIN)]);

    it('never puts a drone within the safe radius of the ship', () => {
      let spawned = 0;
      for (const [x, y] of ships) {
        for (let seed = 1; seed <= 6; seed++) {
          for (const count of [3, 4, 5]) {
            const r = rig({ seed, field, shipX: x, shipY: y });
            r.foes.spawn('drone', count, 1);
            for (const d of r.foes.list) {
              spawned++;
              expect(Math.hypot(d.x - x, d.y - y), `ship (${String(x)}, ${String(y)}) seed ${String(seed)}`).toBeGreaterThanOrEqual(SAFE);
            }
          }
        }
      }
      expect(spawned).toBeGreaterThan(5000);
    });

    it('never overlaps one drone with another, or with the ship, and keeps the whole group on its edge', () => {
      for (const [x, y] of ships) {
        for (let seed = 1; seed <= 6; seed++) {
          const r = rig({ seed, field, shipX: x, shipY: y });
          r.foes.spawn('drone', 5, 1);
          const drones = r.foes.list;
          expect(drones).toHaveLength(5);
          for (const [i, a] of drones.entries()) {
            expect(Math.hypot(a.x - x, a.y - y)).toBeGreaterThan(a.radius + PLAYER.radius);
            for (const b of drones.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius);
            expect(a.x).toBeGreaterThanOrEqual(-WRAP_MARGIN);
            expect(a.x).toBeLessThanOrEqual(field.width + WRAP_MARGIN);
            expect(a.y).toBeGreaterThanOrEqual(-WRAP_MARGIN);
            expect(a.y).toBeLessThanOrEqual(field.height + WRAP_MARGIN);
          }
        }
      }
    });

    it('heads every drone at the ship from the start', () => {
      const r = rig({ field, shipX: 500, shipY: 300 });
      r.foes.spawn('drone', 5, 1);
      for (const d of r.foes.list) {
        const toShip = Math.atan2(300 - d.y, 500 - d.x);
        expect(Math.cos(d.rotation - toShip)).toBeCloseTo(1, 9);
      }
    });
  });
});

describe('FoeField', () => {
  it('draws only from its own stream, the same every time for a seed, and differently for another', () => {
    const layout = (seed: number): number[] => {
      const r = rig({ seed });
      r.foes.spawn('drone', 4, 1);
      r.foes.spawn('splitter', 1, 1);
      return r.foes.list.flatMap((f) => [f.x, f.y, f.vx, f.vy]);
    };
    expect(layout(5)).toEqual(layout(5));
    expect(layout(5)).not.toEqual(layout(6));
  });

  it('drops a spawn beyond its capacity instead of failing, and reuses the pool after a clear', () => {
    const r = rig();
    for (let i = 0; i < FOE_CAPACITY; i++) r.foes.spawn('drone', 5, 1);
    expect(r.foes.list).toHaveLength(FOE_CAPACITY);
    const made = new Set(r.foes.list);
    r.foes.clear();
    expect(r.foes.list).toEqual([]);
    r.foes.spawn('drone', 3, 1);
    expect(r.foes.list).toHaveLength(3);
    expect(r.foes.list.every((f) => f.hp === 1)).toBe(true);
    expect(r.foes.list.every((f) => made.has(f))).toBe(true);
  });

  it('sums its cost: 3 for a splitter and 1 for each drone', () => {
    const r = rig();
    r.foes.spawn('splitter', 1, 1);
    r.foes.spawn('drone', 4, 1);
    expect(r.foes.cost).toBe(3 + 4 * 1);
  });

  it('clears every foe for 0 points, with no fragments and no kill', () => {
    const r = rig();
    r.foes.spawn('splitter', 1, 1);
    r.foes.spawn('drone', 3, 1);
    r.arena.events.length = 0;
    r.foes.clear();
    const destroyed = ofType(r.arena.events, 'foeDestroyed');
    expect(destroyed).toHaveLength(4);
    expect(destroyed.every((e) => e.points === 0)).toBe(true);
    expect(r.arena.asteroids).toEqual([]);
    expect(r.awarded).toEqual([]);
    expect(r.killed).toEqual([]);
  });

  it('rescales every foe to a new field, like the World\'s other entities', () => {
    const r = rig();
    r.foes.spawn('splitter', 1, 1);
    const foe = r.foes.list[0];
    if (foe === undefined) throw new Error('a splitter should have arrived');
    foe.x = -WRAP_MARGIN;
    foe.px = -WRAP_MARGIN;
    r.foes.resize(FIELD_43, FIELD_219);
    expect(foe.x).toBeCloseTo(-WRAP_MARGIN, 9);
    foe.x = FIELD_43.width + WRAP_MARGIN;
    r.foes.resize(FIELD_43, FIELD_219);
    expect(foe.x).toBeCloseTo(FIELD_219.width + WRAP_MARGIN, 9);
  });

  it('remembers where each foe was before the step, for interpolated drawing', () => {
    const r = rig();
    r.foes.spawn('splitter', 1, 1);
    const foe = r.foes.list[0];
    if (foe === undefined) throw new Error('a splitter should have arrived');
    const [x, y, rotation] = [foe.x, foe.y, foe.rotation];
    r.foes.step(DT);
    expect([foe.px, foe.py, foe.protation]).toEqual([x, y, rotation]);
    expect(foe.x).not.toBe(x);
  });
});

describe('wrapDelta', () => {
  const period = 1000 + 2 * WRAP_MARGIN;

  it('keeps an offset within half the wrap band as it is', () => {
    for (const d of [0, 10, -10, period / 2, -period / 2]) expect(wrapDelta(d, 1000)).toBe(d);
  });

  it('takes the short way round across an edge', () => {
    expect(wrapDelta(period - 4, 1000)).toBe(-4);
    expect(wrapDelta(-(period - 4), 1000)).toBe(4);
  });
});
