import { describe, expect, it } from 'vitest';
import { practiceSettings, type AsteroidSize } from '../../src/sim/asteroid';
import { ASTEROID, PLAYER, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import type { Ship } from '../../src/sim/ship';
import { isGalaxyStartLives, isPracticeLevel, isStartLives, isWorldSeed, World, type WorldOptions } from '../../src/sim/world';

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

  it('exposes the practice level it was created with, defaulting to 1', () => {
    expect(world({ practiceLevel: 5 }).practiceLevel).toBe(5);
    expect(world().practiceLevel).toBe(1);
  });

  it.each([0, 8, 1.5, Number.NaN])('rejects practice level %s with a RangeError', (practiceLevel) => {
    expect(() => world({ practiceLevel })).toThrow(/practiceLevel.*1.*7/);
    expect(() => world({ practiceLevel })).toThrow(RangeError);
  });

  it('accepts exactly the integer practice levels 1 to 7', () => {
    expect([1, 2, 3, 4, 5, 6, 7].every(isPracticeLevel)).toBe(true);
    expect([0, 8, 1.5, Number.NaN, -1].some(isPracticeLevel)).toBe(false);
  });

  it.each([1, 2, 3])('starts with startLives %i', (startLives) => {
    expect(world({ startLives }).lives).toBe(startLives);
  });

  it('ends the run on the first hit with startLives 1', () => {
    const w = world({ startLives: 1, initialAsteroids: [still(CENTRE.x, CENTRE.y, 3)] });
    const events = stepIntoVulnerability(w, NO_CONTROLS);
    expect(events.map((e) => e.type)).toEqual(['shipHit', 'gameOver']);
    expect(w.status).toBe('gameOver');
  });

  it.each([0, 4, 1.5, Number.NaN])('rejects startLives %s with a RangeError', (startLives) => {
    expect(() => world({ startLives })).toThrow(RangeError);
    expect(() => world({ startLives })).toThrow(/startLives must be an integer from 1 to 3/);
  });

  it('accepts exactly the integer start lives 1 to 3', () => {
    expect([1, 2, 3].every(isStartLives)).toBe(true);
    expect([0, 4, 1.5, Number.NaN, -1].some(isStartLives)).toBe(false);
  });

  it('accepts exactly the integer galaxy (Rank) start lives 1 to 5', () => {
    expect([1, 3, 5].every(isGalaxyStartLives)).toBe(true);
    expect([0, 6, 2.5, Number.NaN, -1].some(isGalaxyStartLives)).toBe(false);
  });

  it('accepts exactly the unsigned 32-bit integer seeds', () => {
    expect([0, 1, 2 ** 32 - 1].every(isWorldSeed)).toBe(true);
    expect([-1, 1.5, Number.NaN, 2 ** 32].some(isWorldSeed)).toBe(false);
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

  it('rejects a resize to an empty field with a RangeError', () => {
    expect(() => {
      world().resize({ width: 0, height: 720 });
    }).toThrow(RangeError);
  });

  describe.each<[string, number, number]>([
    ['shrink', 1680, 960],
    ['grow', 960, 1680],
  ])('resize (%s %i → %i)', (_name, from, to) => {
    function resized() {
      const w = new World({ seed: 7, field: { width: from, height: 720 }, practiceLevel: 7 });
      runScript(w, 3);
      const before = { ship: { ...w.ship }, asteroids: w.asteroids.map((a) => a.x), projectiles: w.projectiles.length };
      const field: Field = { width: to, height: 720 };
      w.resize(field);
      return { w, field, before };
    }

    it('keeps every entity within the new wrap band', () => {
      const { w, field, before } = resized();
      expect(w.field).toEqual(field);
      expect(before.projectiles).toBeGreaterThan(0);
      for (const e of [w.ship, ...w.asteroids, ...w.projectiles]) {
        expect(e.x).toBeGreaterThanOrEqual(-WRAP_MARGIN);
        expect(e.x).toBeLessThanOrEqual(field.width + WRAP_MARGIN);
        expect(e.y).toBeGreaterThanOrEqual(-WRAP_MARGIN);
        expect(e.y).toBeLessThanOrEqual(field.height + WRAP_MARGIN);
      }
    });

    it('keeps asteroids on the wrap lines on them', () => {
      const edges = [still(-WRAP_MARGIN, 100, 3), still(from + WRAP_MARGIN, 200, 3)];
      const w = new World({ seed: 1, field: { width: from, height: 720 }, initialAsteroids: edges });
      w.resize({ width: to, height: 720 });
      expect(w.asteroids.map((a) => a.x)).toEqual([-WRAP_MARGIN, to + WRAP_MARGIN]);
    });

    it('keeps the asteroids in left-to-right order without collapsing them onto one line', () => {
      const { w, before } = resized();
      const order = (xs: readonly number[]) => xs.map((_, i) => i).sort((i, j) => (xs[i] ?? 0) - (xs[j] ?? 0));
      const after = w.asteroids.map((a) => a.x);
      expect(after).toHaveLength(before.asteroids.length);
      expect(order(after)).toEqual(order(before.asteroids));
      const spread = (xs: readonly number[]) => Math.max(...xs) - Math.min(...xs);
      expect(spread(after)).toBeGreaterThan(spread(before.asteroids) * (to / from) * 0.9);
    });

    it('keeps the ship at the same fraction of the wrap band', () => {
      const { w, field, before } = resized();
      const fraction = (x: number, width: number) => (x + WRAP_MARGIN) / (width + 2 * WRAP_MARGIN);
      expect(fraction(w.ship.x, field.width)).toBeCloseTo(fraction(before.ship.x, from), 9);
      expect(w.ship.y).toBe(before.ship.y);
    });
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
    expect(ofType(events, 'asteroidDestroyed')).toEqual([{ type: 'asteroidDestroyed', id: 1, x: 260, y: 360, size, points }]);
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
      { type: 'asteroidDestroyed', id: 2, x: 227, y: 360, size: 3, points: ASTEROID.scores[3] },
    ]);
    expect(w.asteroids[0]).toBe(lower);
    expect(w.projectiles).toHaveLength(0);
  });
});

describe('World overlap order', () => {
  // The World's hash cells are 120 wide, so x = 240 is a cell boundary: the asteroid in the left
  // cell is visited first even though it has the higher index.
  it('the ship takes the highest-indexed overlap even when the hash visits it first', () => {
    const w = world({
      initialShip: { x: 240, y: 60, angle: 0 },
      initialAsteroids: [still(262, 60, 3), still(218, 60, 3)],
    });
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
      { type: 'asteroidDestroyed', id: 2, x: 224, y: 280, size: 3, points: ASTEROID.scores[3] },
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

describe('World render hooks', () => {
  /** Everything the renderer reads, by entity id. */
  function poses(w: World) {
    return new Map([...w.asteroids, ...w.projectiles].map((e) => [e.id, { x: e.x, y: e.y }]));
  }

  it('numbers the opening asteroids 1, 2, 3 and scenario asteroids in order', () => {
    expect(world().asteroids.map((a) => a.id)).toEqual([1, 2, 3]);
    const w = world({ initialAsteroids: [still(10, 10, 3), still(20, 20, 3)] });
    expect(w.asteroids.map((a) => a.id)).toEqual([1, 2]);
  });

  it('never reuses an id and only hands out larger ones, across asteroids and projectiles', () => {
    const w = world({ seed: 7, practiceLevel: 7 });
    const seen = new Set<number>();
    let highest = 0;
    runScript(w, 10, () => {
      for (const e of [...w.asteroids, ...w.projectiles]) {
        if (!seen.has(e.id)) {
          expect(e.id).toBeGreaterThan(highest);
          seen.add(e.id);
        }
      }
      highest = Math.max(highest, ...seen);
    });
    expect(seen.size).toBeGreaterThan(20);
    const live = [...w.asteroids, ...w.projectiles].map((e) => e.id);
    expect(new Set(live).size).toBe(live.length);
  });

  it('gives split children fresh ids and reports the destroyed id on the event', () => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(260, 360, 0)] });
    const parentId = w.asteroids[0]?.id;
    const events = stepUntil(w, FIRE, (e) => ofType(e, 'asteroidDestroyed').length > 0);
    expect(ofType(events, 'asteroidDestroyed').map((e) => e.id)).toEqual([parentId]);
    const children = w.asteroids.filter((a) => a.x === 260 && a.y === 360);
    expect(children).toHaveLength(2);
    expect(children.map((a) => a.id)).not.toContain(parentId);
    expect(new Set(children.map((a) => a.id)).size).toBe(2);
    expect(w.asteroids.map((a) => a.id)).not.toContain(parentId);
  });

  it('keeps px/py/pangle/protation at the pose from before the latest step', () => {
    const w = world({ seed: 7, practiceLevel: 7 });
    let checked = 0;
    for (let i = 0; i < 6 * STEPS_PER_SECOND; i++) {
      const before = poses(w);
      const ship = { x: w.ship.x, y: w.ship.y, angle: w.ship.angle };
      const rotations = new Map(w.asteroids.map((a) => [a.id, a.rotation]));
      w.step(STEP_SECONDS, scriptedControls(i));
      expect(w.ship).toMatchObject({ px: ship.x, py: ship.y, pangle: ship.angle });
      for (const e of [...w.asteroids, ...w.projectiles]) {
        const was = before.get(e.id);
        if (was !== undefined) {
          expect([e.px, e.py]).toEqual([was.x, was.y]);
          checked++;
        }
      }
      for (const a of w.asteroids) {
        const was = rotations.get(a.id);
        if (was !== undefined) expect(a.protation).toBe(was);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('starts new projectiles at their muzzle pose and new asteroids at their spawn pose', () => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(1000, 100, 3)] });
    const [shot] = ofType(w.step(STEP_SECONDS, FIRE), 'shot');
    const projectile = w.projectiles[0];
    expect([projectile?.px, projectile?.py]).toEqual([shot?.x, shot?.y]);

    const spawned = world({ seed: 4 });
    const firstIds = new Set(spawned.asteroids.map((a) => a.id));
    spawned.step(STEP_SECONDS, NO_CONTROLS);
    const fresh = spawned.asteroids.filter((a) => !firstIds.has(a.id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const a of fresh) expect([a.px, a.py, a.protation]).toEqual([a.x, a.y, a.rotation]);
  });

  it('gives split children their parent pose as previous pose', () => {
    const w = world({ initialShip: SHOOTER, initialAsteroids: [still(260, 360, 0)] });
    stepUntil(w, FIRE, (e) => ofType(e, 'asteroidDestroyed').length > 0);
    for (const c of w.asteroids.filter((a) => a.x === 260 && a.y === 360)) {
      expect([c.px, c.py, c.protation]).toEqual([c.x, c.y, c.rotation]);
    }
  });

  it('snaps the previous pose to the respawn pose so the ship does not streak', () => {
    const w = world({ initialShip: PARKED, initialAsteroids: [still(300, 300, 1)] });
    stepUntil(w, NO_CONTROLS, (e) => ofType(e, 'shipHit').length > 0);
    expect(w.ship).toMatchObject({ x: CENTRE.x, y: CENTRE.y, px: CENTRE.x, py: CENTRE.y, pangle: w.ship.angle });
  });

  it('starts the ship with its previous pose equal to its pose', () => {
    expect(world({ initialShip: PARKED }).ship).toMatchObject({ px: 300, py: 300, pangle: 0, angle: 0 });
    expect(world().ship).toMatchObject({ px: CENTRE.x, py: CENTRE.y, pangle: -Math.PI / 2 });
  });

  it('rescales the previous position exactly like the position on resize', () => {
    const w = new World({ seed: 7, field: { width: 960, height: 720 }, practiceLevel: 7 });
    runScript(w, 3);
    w.resize({ width: 1680, height: 540 });
    expect(w.asteroids.length).toBeGreaterThan(0);
    const p = w.asteroids[0];
    const old = new World({ seed: 7, field: { width: 960, height: 720 }, practiceLevel: 7 });
    runScript(old, 3);
    const o = old.asteroids[0];
    const map = (v: number, from: number, to: number) =>
      ((v + WRAP_MARGIN) * (to + 2 * WRAP_MARGIN)) / (from + 2 * WRAP_MARGIN) - WRAP_MARGIN;
    expect(p?.px).toBe(map(o?.px ?? 0, 960, 1680));
    expect(p?.py).toBe(map(o?.py ?? 0, 720, 540));
  });

  it('leaves the seed-2 event log exactly as it was before the hooks existed', () => {
    const log = runScript(world({ seed: 2 }), 5).map((e) => {
      const r = e as { type: string; x?: number; y?: number; size?: number; points?: number };
      return { type: r.type, x: r.x, y: r.y, size: r.size, points: r.points };
    });
    const shot = (x: number, y: number) => ({ type: 'shot', x, y, size: undefined, points: undefined });
    const kill = (x: number, y: number) => ({ type: 'asteroidDestroyed', x, y, size: 3, points: 150 });
    expect(log).toEqual([
      shot(639.3335262178236, 344.0138868796173),
      shot(619.5371682151705, 353.8273655557581),
      shot(610.2888789118482, 360.7893642503523),
      shot(597.8248920978847, 358.78350471502625),
      shot(578.8900879661678, 340.3827033649238),
      shot(551.63491276749, 317.89135960580575),
      shot(522.2885782263027, 323.56978922585165),
      shot(506.53453334420504, 327.71485760060165),
      kill(284.82433271841234, 326.8762479437502),
      shot(489.6386135846498, 323.790013231187),
      shot(467.6846321419521, 304.08193680668194),
      kill(424.04726872724774, 275.020060025341),
      shot(436.62973474017224, 279.94534945497855),
      shot(406.4378655916802, 285.2576706279805),
      shot(390.10781495016295, 289.1533339845942),
      shot(372.81950127554063, 285.0585867801763),
    ]);
  });
});

describe('World shape wiring', () => {
  // Golden outlines: dropping this.shapeRng at any World creation call site draws vertices from
  // the gameplay stream instead, which changes these values.
  const outline = (a: { vertices: readonly { x: number; y: number }[] }) =>
    a.vertices.map(({ x, y }) => `${x.toFixed(9)} ${y.toFixed(9)}`);

  it('pins the first 3 practice spawns of seed 2, level 7', () => {
    const w = world({ seed: 2, practiceLevel: 7 });
    expect(w.asteroids.slice(0, 3).map(outline)).toMatchInlineSnapshot(`
      [
        [
          "10.561899565 0.000000000",
          "11.740173612 11.740173612",
          "0.000000000 11.580139993",
          "-7.487840160 7.487840160",
          "-14.711133258 0.000000000",
          "-12.006865177 -12.006865177",
          "-0.000000000 -14.472416578",
          "11.313860043 -11.313860043",
        ],
        [
          "18.797364436 0.000000000",
          "10.031859400 12.579553800",
          "-3.438845412 15.066566180",
          "-14.007318269 6.745568956",
          "-11.783108394 -5.674445933",
          "-3.954451351 -17.325583400",
          "8.904545196 -11.165946500",
        ],
        [
          "28.977758500 0.000000000",
          "14.210890046 10.324815979",
          "5.526268739 17.008106320",
          "-8.119067520 24.987920445",
          "-24.507846686 17.805992887",
          "-26.641947476 0.000000000",
          "-16.904191094 -12.281613732",
          "-5.506795877 -16.948175014",
          "6.731197043 -20.716494324",
          "18.497154328 -13.438969266",
        ],
      ]
    `);
  });

  it('pins a scenario asteroid and the children it splits into', () => {
    const w = world({ seed: 2, practiceLevel: 7, initialShip: SHOOTER, initialAsteroids: [still(260, 360, 0)] });
    const parent = outline(w.asteroids[0] ?? { vertices: [] });
    stepUntil(w, FIRE, (e) => ofType(e, 'asteroidDestroyed').length > 0);
    const children = w.asteroids.filter((a) => a.x === 260 && a.y === 360).map(outline);
    expect({ parent, children }).toMatchInlineSnapshot(`
      {
        "children": [
          [
            "50.126305163 0.000000000",
            "26.751625066 33.545476800",
            "-9.170254432 40.177509813",
            "-37.352848718 17.988183883",
            "-31.421622383 -15.131855821",
            "-10.545203603 -46.201555732",
            "23.745453855 -29.775857334",
          ],
          [
            "46.364413600 0.000000000",
            "22.737424074 16.519705567",
            "8.842029982 27.212970112",
            "-12.990508033 39.980672711",
            "-39.212554698 28.489588620",
            "-42.627115961 0.000000000",
            "-27.046705751 -19.650581970",
            "-8.810873404 -27.117080022",
            "10.769915268 -33.146390918",
            "29.595446925 -21.502350826",
          ],
        ],
        "parent": [
          "42.247598260 0.000000000",
          "46.960694447 46.960694447",
          "0.000000000 46.320559974",
          "-29.951360640 29.951360640",
          "-58.844533031 0.000000000",
          "-48.027460710 -48.027460710",
          "-0.000000000 -57.889666311",
          "45.255440173 -45.255440173",
        ],
      }
    `);
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
