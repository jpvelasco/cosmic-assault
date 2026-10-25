import { describe, expect, it } from 'vitest';
import { practiceSettings, type AsteroidSize } from '../../src/sim/asteroid';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import type { Ship } from '../../src/sim/ship';
import { World, type WorldOptions } from '../../src/sim/world';

const FIELD: Field = { width: 1280, height: 720 };
const CENTRE = { x: FIELD.width / 2, y: FIELD.height / 2 };
const FIRE: Controls = { ...NO_CONTROLS, fire: true };
const STEPS_PER_SECOND = Math.round(1 / STEP_SECONDS);
/** Faces +x so its shots run along y = 360. */
const SHOOTER = { x: 200, y: 360, angle: 0 };
/** Off-centre, so a respawn is visible. */
const PARKED = { x: 300, y: 300, angle: 0 };

type Scenario = Omit<WorldOptions, 'field' | 'seed'> & { readonly seed?: number };

function world(opts: Scenario = {}): World {
  return new World({ seed: 1, field: FIELD, ...opts });
}

/** A motionless asteroid, so a scenario stays where the test put it. */
function still(x: number, y: number, size: AsteroidSize) {
  return { x, y, size, angle: 0, speedMultiplier: 0 };
}

/** Mixed turning, thrust and fire that changes every half second. */
function scriptedControls(step: number): Controls {
  const phase = Math.floor(step / (STEPS_PER_SECOND / 2)) % 4;
  const turns = [-1, 0, 1, 0] as const;
  return { turn: turns[phase] ?? 0, thrust: phase % 2 === 0, fire: phase !== 3, stick: null };
}

function runScript(w: World, seconds: number, onStep?: (events: readonly SimEvent[]) => void): SimEvent[] {
  const log: SimEvent[] = [];
  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    const events = w.step(STEP_SECONDS, scriptedControls(i));
    log.push(...events.map((e) => ({ ...e })));
    onStep?.(events);
  }
  return log;
}

function stepUntil(w: World, controls: Controls, done: (events: readonly SimEvent[]) => boolean, maxSteps = 2000) {
  for (let i = 0; i < maxSteps; i++) {
    const events = w.step(STEP_SECONDS, controls);
    if (done(events)) {
      return events;
    }
  }
  throw new Error(`condition not reached within ${String(maxSteps)} steps`);
}

/** Idles until the ship's invulnerability is about to end, then runs that step with `controls`. */
function stepIntoVulnerability(w: World, controls: Controls): readonly SimEvent[] {
  while (w.ship.invulnerableFor - STEP_SECONDS > 0) {
    w.step(STEP_SECONDS, NO_CONTROLS);
  }
  return w.step(STEP_SECONDS, controls);
}

/** Tags each asteroid sitting exactly at one of the named points, in list order. */
function tagsAt(w: World, points: Readonly<Record<string, { x: number; y: number }>>): string[] {
  return w.asteroids.flatMap((a) =>
    Object.entries(points)
      .filter(([, p]) => p.x === a.x && p.y === a.y)
      .map(([tag]) => tag),
  );
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function snapshot(w: World) {
  return JSON.stringify({
    ship: w.ship,
    asteroids: w.asteroids,
    projectiles: w.projectiles,
    score: w.score,
    lives: w.lives,
    status: w.status,
    elapsed: w.elapsed,
  });
}

describe('World start of a run', () => {
  it('starts playing with 3 lives, no score and 3 practice asteroids', () => {
    const w = world();
    expect(w.status).toBe('playing');
    expect(w.lives).toBe(PLAYER.startLives);
    expect(w.score).toBe(0);
    expect(w.elapsed).toBe(0);
    expect(w.asteroids).toHaveLength(3);
    expect(w.projectiles).toHaveLength(0);
    expect(w.field).toEqual(FIELD);
  });

  it('starts the ship at the centre, invulnerable for 3 s', () => {
    const { ship } = world();
    expect(ship.x).toBe(CENTRE.x);
    expect(ship.y).toBe(CENTRE.y);
    expect(ship.invulnerable).toBe(true);
    expect(ship.invulnerableFor).toBe(PLAYER.invulnerableSeconds);
  });

  it('places the ship and asteroids from a scenario', () => {
    const w = world({ initialShip: { x: 100, y: 200, angle: 0.5 }, initialAsteroids: [still(300, 400, 1)] });
    expect(w.ship).toMatchObject({ x: 100, y: 200, angle: 0.5, invulnerable: true });
    expect(w.asteroids).toHaveLength(1);
    expect(w.asteroids[0]).toMatchObject({ x: 300, y: 400, size: 1, vx: 0, vy: 0 });
  });

  it('builds scenario asteroids deterministically from the seed', () => {
    const shape = (seed: number) => world({ seed, initialAsteroids: [still(0, 0, 0)] }).asteroids[0]?.vertices;
    expect(shape(5)).toEqual(shape(5));
    expect(shape(5)).not.toEqual(shape(6));
  });

  it.each([0, 8, 1.5, Number.NaN])('rejects practice level %s with a RangeError', (practiceLevel) => {
    expect(() => world({ practiceLevel })).toThrow(/practiceLevel.*1.*7/);
    expect(() => world({ practiceLevel })).toThrow(RangeError);
  });

  it.each([-1, 1.5, Number.NaN, 2 ** 32])('rejects seed %s with a RangeError', (seed) => {
    expect(() => world({ seed })).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects field width %s with a RangeError', (width) => {
    expect(() => new World({ seed: 1, field: { width, height: 720 } })).toThrow(RangeError);
  });

  it.each([
    ['x', { x: Number.NaN, y: 0, angle: 0 }],
    ['angle', { x: 0, y: 0, angle: Number.POSITIVE_INFINITY }],
  ])('rejects a non-finite initialShip %s with a RangeError', (_field, initialShip) => {
    expect(() => world({ initialShip })).toThrow(RangeError);
    expect(() => world({ initialShip })).toThrow(/WorldOptions\.initialShip/);
  });

  it.each([
    ['size 4', { ...still(0, 0, 0), size: 4 as AsteroidSize }],
    ['size 1.5', { ...still(0, 0, 0), size: 1.5 as AsteroidSize }],
    ['NaN y', still(0, Number.NaN, 0)],
    ['infinite angle', { ...still(0, 0, 0), angle: Number.NEGATIVE_INFINITY }],
    ['NaN speedMultiplier', { ...still(0, 0, 0), speedMultiplier: Number.NaN }],
  ])('rejects an initial asteroid with %s with a RangeError', (_case, bad) => {
    const initialAsteroids = [still(0, 0, 1), bad];
    expect(() => world({ initialAsteroids })).toThrow(RangeError);
    expect(() => world({ initialAsteroids })).toThrow(/WorldOptions\.initialAsteroids\[1\]/);
  });

  it('exposes read-only state', () => {
    const w = world();
    expect(() => {
      // @ts-expect-error score is a read-only getter
      w.score = 99;
    }).toThrow(TypeError);
  });
});

describe('World.step', () => {
  it.each([0, -STEP_SECONDS, Number.NaN, Number.POSITIVE_INFINITY])('rejects dt %s with a RangeError', (dt) => {
    expect(() => world().step(dt, NO_CONTROLS)).toThrow(RangeError);
  });

  it('advances elapsed time by dt', () => {
    const w = world();
    w.step(STEP_SECONDS, NO_CONTROLS);
    w.step(STEP_SECONDS, NO_CONTROLS);
    expect(w.elapsed).toBeCloseTo(2 * STEP_SECONDS, 12);
  });

  it('turns shots into projectiles and shot events', () => {
    const w = world({ initialAsteroids: [] });
    const events = w.step(STEP_SECONDS, FIRE);
    const shots = ofType(events, 'shot');
    expect(shots).toHaveLength(1);
    expect(w.projectiles).toHaveLength(1);
    expect(shots[0]?.x).toBeCloseTo(CENTRE.x, 9);
    expect(shots[0]?.y).toBeCloseTo(CENTRE.y - PLAYER.noseOffset, 9);
  });

  it('reuses one events array, cleared at the start of every step', () => {
    const w = world({ initialAsteroids: [] });
    const first = w.step(STEP_SECONDS, FIRE);
    expect(first).toHaveLength(1);
    const second = w.step(STEP_SECONDS, NO_CONTROLS);
    expect(second).toBe(first);
    expect(second).toHaveLength(0);
  });

  it('drops projectiles once their lifespan runs out', () => {
    const w = world({ initialAsteroids: [] });
    w.step(STEP_SECONDS, FIRE);
    for (let i = 1; i < 1.2 * STEPS_PER_SECOND - 1; i++) {
      w.step(STEP_SECONDS, NO_CONTROLS);
    }
    expect(w.projectiles).toHaveLength(1);
    w.step(STEP_SECONDS, NO_CONTROLS);
    expect(w.projectiles).toHaveLength(0);
  });

  it('keeps entities when resized', () => {
    const w = world();
    w.step(STEP_SECONDS, FIRE);
    const before = { ship: { ...w.ship }, asteroids: w.asteroids.length, projectiles: w.projectiles.length };
    const wide: Field = { width: 1680, height: 720 };
    w.resize(wide);
    expect(w.field).toEqual(wide);
    expect(w.ship).toEqual(before.ship);
    expect(w.asteroids).toHaveLength(before.asteroids);
    expect(w.projectiles).toHaveLength(before.projectiles);
    expect(() => {
      w.resize({ width: 0, height: 720 });
    }).toThrow(RangeError);
  });
});

describe('World determinism', () => {
  it('replays the same seed and inputs identically', () => {
    const a = world({ seed: 2 });
    const b = world({ seed: 2 });
    const logA = runScript(a, 5);
    const logB = runScript(b, 5);
    expect(logA.length).toBeGreaterThan(0);
    expect(ofType(logA, 'asteroidDestroyed').length).toBeGreaterThan(0);
    expect(logB).toEqual(logA);
    expect(b.score).toBe(a.score);
    expect(b.asteroids.length).toBe(a.asteroids.length);
    expect(b.ship).toEqual(a.ship);
    expect(snapshot(b)).toBe(snapshot(a));
  });

  it('gives a different run for a different seed', () => {
    expect(runScript(world({ seed: 3 }), 5)).not.toEqual(runScript(world({ seed: 2 }), 5));
  });
});

describe('World scoring', () => {
  it.each([
    [0, 20],
    [3, 150],
  ] as const)('destroying a size-%i asteroid adds %i', (size, points) => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(260, 360, size)] });
    const events = stepUntil(w, FIRE, (e) => ofType(e, 'asteroidDestroyed').length > 0);
    expect(ofType(events, 'asteroidDestroyed')).toEqual([
      { type: 'asteroidDestroyed', x: 260, y: 360, size, points },
    ]);
    expect(w.score).toBe(points);
  });

  it('awards exactly the table score for every kill over a practice-level-7 run', () => {
    const w = world({ seed: 7, practiceLevel: 7 });
    let emitted = 0;
    const log = runScript(w, 10, (events) => {
      for (const e of ofType(events, 'asteroidDestroyed')) {
        expect(e.points).toBe(ASTEROID.scores[e.size]);
        emitted += e.points;
      }
    });
    expect(ofType(log, 'asteroidDestroyed').length).toBeGreaterThan(5);
    expect(w.score).toBe(emitted);
  });
});

describe('World splitting and removal', () => {
  it.each([0, 1, 2] as const)('replaces a hit size-%i asteroid with 2 smaller children at its position', (size) => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(260, 360, size)] });
    const parent = w.asteroids[0];
    stepUntil(w, FIRE, (e) => ofType(e, 'asteroidDestroyed').length > 0);
    expect(w.asteroids).not.toContain(parent);
    const children = w.asteroids.filter((a) => a.x === 260 && a.y === 360);
    expect(children.map((a) => a.size)).toEqual([size + 1, size + 1]);
  });

  it('removes a hit tiny asteroid without children', () => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(260, 360, 3)] });
    stepUntil(w, FIRE, (e) => ofType(e, 'asteroidDestroyed').length > 0);
    expect(w.asteroids.filter((a) => a.x === 260 && a.y === 360)).toHaveLength(0);
  });

  it('consumes a projectile once even when it overlaps two asteroids (CA-021)', () => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(400, 360, 2), still(400, 360, 2)] });
    const [lower, upper] = w.asteroids;
    let older: unknown;
    let newer: unknown;
    const events = stepUntil(w, FIRE, (e) => {
      if (ofType(e, 'asteroidDestroyed').length > 0) {
        return true;
      }
      [older, newer] = w.projectiles;
      return false;
    });
    expect(older).toBeDefined();
    expect(newer).toBeDefined();
    expect(ofType(events, 'asteroidDestroyed')).toHaveLength(1);
    expect(w.asteroids[0]).toBe(lower);
    expect(w.asteroids).not.toContain(upper);
    expect(w.projectiles).toEqual([newer]);
    expect(w.projectiles[0]).toBe(newer);
    expect(w.score).toBe(ASTEROID.scores[2]);
  });

  it('destroys only the last-indexed asteroid under a projectile', () => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(225, 360, 3), still(227, 360, 3)] });
    const [lower] = w.asteroids;
    const events = w.step(STEP_SECONDS, FIRE);
    expect(ofType(events, 'asteroidDestroyed')).toEqual([
      { type: 'asteroidDestroyed', x: 227, y: 360, size: 3, points: ASTEROID.scores[3] },
    ]);
    expect(w.asteroids[0]).toBe(lower);
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('World overlap order', () => {
  // The World's hash cells are 120 wide, so x = 240 is a cell boundary: the asteroid in the left
  // cell is visited first even though it has the higher index.
  it('the ship takes the highest-indexed overlap even when the hash visits it first', () => {
    const w = world({ initialShip: { x: 240, y: 60, angle: 0 }, initialAsteroids: [still(262, 60, 3), still(218, 60, 3)] });
    const [right, left] = w.asteroids;
    const events = stepIntoVulnerability(w, NO_CONTROLS);
    expect(ofType(events, 'shipHit')).toHaveLength(1);
    expect(w.asteroids).toContain(right);
    expect(w.asteroids).not.toContain(left);
  });

  it('a projectile takes the highest-indexed overlap even when the hash visits it first', () => {
    const w = world({
      initialShip: { x: 240, y: 300, angle: -Math.PI / 2 },
      initialAsteroids: [still(256, 280, 3), still(224, 280, 3)],
    });
    const events = w.step(STEP_SECONDS, FIRE);
    expect(ofType(events, 'asteroidDestroyed')).toEqual([
      { type: 'asteroidDestroyed', x: 224, y: 280, size: 3, points: ASTEROID.scores[3] },
    ]);
  });

  it('scans projectiles from last to first, so the newer shot claims a shared asteroid', () => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(225, 360, 3)] });
    // Weapon upgrades arrive after M1; set the tier directly to get a two-shot volley.
    (w.ship as Ship).tier = 2;
    const events = w.step(STEP_SECONDS, FIRE);
    expect(ofType(events, 'shot')).toHaveLength(2);
    expect(ofType(events, 'asteroidDestroyed')).toHaveLength(1);
    expect(w.projectiles).toHaveLength(1);
    expect(w.projectiles[0]?.vy).toBeLessThan(0);
  });

  it('appends children in break order: the ship hit first, then projectile hits', () => {
    const shipTarget = { x: 270, y: 300 };
    const shotTarget = { x: 336, y: 300 };
    const w = world({
      initialShip: PARKED,
      initialAsteroids: [still(shotTarget.x, shotTarget.y, 2), still(shipTarget.x, shipTarget.y, 1)],
    });
    const events = stepIntoVulnerability(w, FIRE);
    expect(events.map((e) => e.type).filter((t) => t !== 'shot')).toEqual(['shipHit', 'asteroidDestroyed']);
    expect(tagsAt(w, { ship: shipTarget, shot: shotTarget })).toEqual(['ship', 'ship', 'shot', 'shot']);
  });
});

describe('World lives', () => {
  it('ignores collisions while the ship is invulnerable', () => {
    const w = world({ initialAsteroids: [still(CENTRE.x, CENTRE.y, 0)] });
    const events = w.step(STEP_SECONDS, NO_CONTROLS);
    expect(ofType(events, 'shipHit')).toHaveLength(0);
    expect(w.lives).toBe(3);
    expect(w.asteroids[0]).toMatchObject({ x: CENTRE.x, y: CENTRE.y, size: 0 });
  });

  it('loses a life, splits the asteroid and respawns the ship on a hit', () => {
    const w = world({ initialShip: PARKED, initialAsteroids: [still(300, 300, 1)] });
    const parent = w.asteroids[0];
    const events = stepUntil(w, NO_CONTROLS, (e) => ofType(e, 'shipHit').length > 0);
    expect(w.elapsed).toBeGreaterThanOrEqual(PLAYER.invulnerableSeconds - 1e-9);
    expect(ofType(events, 'shipHit')).toEqual([{ type: 'shipHit', x: 300, y: 300, livesLeft: 2 }]);
    expect(w.lives).toBe(2);
    expect(w.asteroids).not.toContain(parent);
    expect(w.asteroids.filter((a) => a.x === 300 && a.y === 300).map((a) => a.size)).toEqual([2, 2]);
    expect(w.ship).toMatchObject({ x: CENTRE.x, y: CENTRE.y, vx: 0, vy: 0, invulnerable: true });
  });

  it('does not let a projectile score an asteroid the ship already broke this step', () => {
    const w = world({ initialShip: PARKED, initialAsteroids: [still(330, 300, 0)] });
    const events = stepIntoVulnerability(w, FIRE);
    expect(ofType(events, 'shipHit')).toHaveLength(1);
    expect(ofType(events, 'shot')).toHaveLength(1);
    expect(ofType(events, 'asteroidDestroyed')).toHaveLength(0);
    expect(w.score).toBe(0);
    expect(w.projectiles).toHaveLength(1);
    expect(w.asteroids.filter((a) => a.x === 330 && a.y === 300).map((a) => a.size)).toEqual([1, 1]);
  });

  it('skips projectile hits on the step that ends the run', () => {
    const tiny = still(CENTRE.x, CENTRE.y, 3);
    const target = still(CENTRE.x, CENTRE.y - 30, 3);
    const w = world({ initialAsteroids: [tiny, tiny, tiny, target] });
    stepIntoVulnerability(w, NO_CONTROLS);
    stepIntoVulnerability(w, NO_CONTROLS);
    expect(w.lives).toBe(1);
    const events = stepIntoVulnerability(w, FIRE);
    expect(events.map((e) => e.type)).toEqual(['shot', 'shipHit', 'gameOver']);
    expect(w.score).toBe(0);
    expect(tagsAt(w, { target })).toEqual(['target']);
  });

  it('takes the last-indexed overlapping asteroid, one hit per step', () => {
    const w = world({
      initialShip: PARKED,
      initialAsteroids: [still(300, 300, 3), still(300, 300, 2)],
    });
    const [lower, upper] = w.asteroids;
    const events = stepUntil(w, NO_CONTROLS, (e) => ofType(e, 'shipHit').length > 0);
    expect(ofType(events, 'shipHit')).toHaveLength(1);
    expect(w.asteroids).toContain(lower);
    expect(w.asteroids).not.toContain(upper);
  });

  it('ends the run after 3 hits, emits gameOver once and then ignores steps', () => {
    const tiny = still(CENTRE.x, CENTRE.y, 3);
    const w = world({ initialAsteroids: [tiny, tiny, tiny] });
    const log: SimEvent[] = [];
    stepUntil(
      w,
      NO_CONTROLS,
      (e) => {
        log.push(...e.map((x) => ({ ...x })));
        return w.status === 'gameOver';
      },
      20 * STEPS_PER_SECOND,
    );
    expect(ofType(log, 'shipHit').map((e) => e.livesLeft)).toEqual([2, 1, 0]);
    expect(ofType(log, 'gameOver')).toEqual([{ type: 'gameOver', score: 0 }]);
    expect(log.at(-1)).toEqual({ type: 'gameOver', score: 0 });
    expect(w.lives).toBe(0);

    const before = snapshot(w);
    expect(w.step(STEP_SECONDS, FIRE)).toHaveLength(0);
    expect(snapshot(w)).toBe(before);
  });
});

describe('World practice spawning', () => {
  it('spawns at once (timer starts at 0), fills to the minimum, then waits a spawn interval', () => {
    const w = world({ initialShip: { x: 0, y: 0, angle: 0 }, initialAsteroids: [] });
    const counts: number[] = [];
    const interval = practiceSettings(1).spawnInterval * STEPS_PER_SECOND;
    for (let i = 0; i <= interval + 1; i++) {
      w.step(STEP_SECONDS, NO_CONTROLS);
      counts.push(w.asteroids.length);
    }
    expect(counts.slice(0, 3)).toEqual([2, 3, 3]);
    expect(counts[interval - 1]).toBe(3);
    expect(counts[interval]).toBe(4);
  });

  it('never leaves fewer than 3 asteroids after a step at level 1', () => {
    const w = world({ seed: 9 });
    runScript(w, 10, () => {
      expect(w.asteroids.length).toBeGreaterThanOrEqual(practiceSettings(1).minAsteroids);
    });
  });

  it('spawns the minimum for higher practice levels', () => {
    const w = world({ practiceLevel: 7 });
    w.step(STEP_SECONDS, NO_CONTROLS);
    expect(w.asteroids.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 20; i++) {
      w.step(STEP_SECONDS, NO_CONTROLS);
    }
    expect(w.asteroids.length).toBeGreaterThanOrEqual(practiceSettings(7).minAsteroids);
  });
});

describe('World.endRun', () => {
  it('sets gameOver without emitting and freezes the world', () => {
    const w = world();
    w.endRun();
    expect(w.status).toBe('gameOver');
    const before = snapshot(w);
    expect(w.step(STEP_SECONDS, FIRE)).toHaveLength(0);
    expect(snapshot(w)).toBe(before);
  });
});
