import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import type { FoeKind, GalaxyDef, GalaxyId } from '../../src/content/types';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { fieldBudget } from '../../src/sim/galaxy/director';
import { FOE_CAPACITY } from '../../src/sim/foes/foeField';
import type { Foe } from '../../src/sim/foes/foe';
import { World } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';

const FIELD: Field = { width: 1280, height: 720 };
const FIRE: Controls = { ...NO_CONTROLS, fire: true };
const ALWAYS = { from: 0, base: 1, step: 0, max: 1 };

/** A galaxy that spawns only `kind`, once the director first rolls (after the opening's slow interval). */
function only(id: GalaxyId, kind: FoeKind): GalaxyDef {
  return { ...galaxyById(id), kinds: { ...MUTED_KINDS, [kind]: ALWAYS }, events: [] };
}

function make(galaxy: GalaxyDef, opts: { seed?: number; lives?: number } = {}): World {
  return new World({
    seed: opts.seed ?? 1,
    field: FIELD,
    rules: { kind: 'galaxy', galaxy, mode: 'rank' },
    ...(opts.lives === undefined ? {} : { startLives: opts.lives }),
    initialShip: { x: 200, y: 360, angle: 0 },
  });
}

function step(w: World, controls: Controls = NO_CONTROLS): readonly SimEvent[] {
  return w.step(STEP_SECONDS, controls);
}

/** Steps until a `foeSpawned` event, returning the world's first foe, as the live object. */
function untilFoe(w: World): Foe {
  for (let i = 0; i < 40 * 120; i++) {
    if (step(w).some((e) => e.type === 'foeSpawned')) {
      const foe = w.foes[0];
      if (foe === undefined) break;
      return foe;
    }
  }
  throw new Error('no foe arrived within 40 s');
}

/** Puts the foe at rest at (x, y), as a scenario would. */
function park(foe: Foe, x: number, y: number): void {
  Object.assign(foe, { x, y, px: x, py: y, vx: 0, vy: 0, spin: 0 });
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('a splitter in a galaxy run', () => {
  const galaxy = only('1-3', 'splitter');

  it('is spawned by the director, shown in `foes`, and shot twice to break it into three transient fragments', () => {
    const w = make(galaxy);
    const splitter = untilFoe(w);
    expect(splitter.kind).toBe('splitter');
    expect(w.foes).toHaveLength(1);
    park(splitter, 500, 360);
    const log: SimEvent[] = [];
    for (let i = 0; i < 120 && w.foes.length > 0; i++) log.push(...step(w, FIRE).map((e) => ({ ...e })));
    expect(ofType(log, 'foeHit')).toHaveLength(1);
    expect(ofType(log, 'foeHit')[0]).toMatchObject({ hp: 1 });
    expect(ofType(log, 'foeDestroyed')).toMatchObject([{ kind: 'splitter', points: 100 }]);
    expect(ofType(log, 'asteroidDestroyed')).toEqual([]);
    expect(w.score).toBe(100);
    expect(w.combo).toBe(1);
    expect(w.foes).toEqual([]);
    const fragments = w.asteroids.filter((a) => a.size === 3);
    expect(fragments).toHaveLength(3);
    expect(fragments.every((a) => a.transient === true)).toBe(true);
  });

  it('costs the ship a life when it rams one, scoring nothing but still breaking into fragments', () => {
    const w = make(galaxy);
    const splitter = untilFoe(w);
    // Past the spawn invulnerability.
    for (let i = 0; i < 3.1 * 120; i++) step(w);
    park(splitter, w.ship.x, w.ship.y);
    const events = step(w);
    expect(events.map((e) => e.type)).toContain('shipHit');
    expect(ofType(events, 'foeDestroyed')).toMatchObject([{ kind: 'splitter', points: 0 }]);
    expect(w.lives).toBe(2);
    expect(w.score).toBe(0);
    expect(w.asteroids.filter((a) => a.size === 3)).toHaveLength(3);
  });
});

describe('a drone in a galaxy run', () => {
  const galaxy = only('2-1', 'drone');

  it('arrives as a group of 3 to 5, safe from the ship, and a shot kills one for 100', () => {
    const w = make(galaxy);
    untilFoe(w);
    expect(w.foes.length).toBeGreaterThanOrEqual(3);
    expect(w.foes.length).toBeLessThanOrEqual(5);
    const drone = w.foes[0];
    if (drone === undefined) throw new Error('a drone should have arrived');
    park(drone, 500, 360);
    const log: SimEvent[] = [];
    for (let i = 0; i < 60 && w.foes.includes(drone); i++) log.push(...step(w, FIRE).map((e) => ({ ...e })));
    expect(ofType(log, 'foeDestroyed')).toMatchObject([{ kind: 'drone', points: 100 }]);
    expect(w.score).toBe(100);
    expect(w.combo).toBe(1);
  });

  it('counts every kill toward the one combo, which multiplies the points it scores', () => {
    const w = make(galaxy);
    untilFoe(w);
    const drones = w.foes.slice(0, 4) as Foe[];
    for (const [i, drone] of drones.entries()) park(drone, 500 + i * 60, 360);
    let kills = 0;
    for (let i = 0; i < 4 * 120 && kills < drones.length; i++) kills += ofType(step(w, FIRE), 'foeDestroyed').length;
    expect(drones.length).toBeGreaterThanOrEqual(3);
    expect(kills).toBe(drones.length);
    expect(w.combo).toBe(kills);
    expect(w.score).toBeGreaterThanOrEqual(100 * kills);
  });

  it('drops a pickup now and then when shot, like a rock does', () => {
    let drops = 0;
    for (let seed = 1; seed <= 60 && drops === 0; seed++) {
      const w = make(galaxy, { seed });
      untilFoe(w);
      for (const [i, foe] of w.foes.entries()) park(foe, 400 + i * 40, 360);
      for (let i = 0; i < 4 * 120; i++) drops += ofType(step(w, FIRE), 'pickupDropped').length;
    }
    expect(drops).toBeGreaterThan(0);
  });

  it('hunts a statue down and costs it a life', () => {
    const w = make(galaxy, { seed: 2 });
    for (let i = 0; i < 40 * 120 && w.deaths === 0; i++) step(w);
    expect(w.deaths).toBeGreaterThan(0);
  });
});

describe('foes and the threat budget', () => {
  it('spawns a group only when the whole group fits the field budget', () => {
    const galaxy = only('2-1', 'drone');
    const w = make(galaxy, { lives: 5 });
    let groups = 0;
    for (let i = 0; i < 90 * 120 && w.status === 'playing'; i++) {
      const spawned = ofType(step(w), 'foeSpawned').length;
      if (spawned === 0 || w.deaths > 0) continue;
      groups++;
      const cost = w.foes.reduce((sum, f) => sum + (f.kind === 'drone' ? 1.5 : 3), 0);
      expect(cost).toBeLessThanOrEqual(fieldBudget(galaxy, w.elapsed, 1, FIELD.width * FIELD.height) + 1e-9);
    }
    expect(groups).toBeGreaterThan(0);
  });

  it('never holds more foes than the pool', () => {
    const w = make(only('2-1', 'drone'), { lives: 5 });
    let peak = 0;
    for (let i = 0; i < 60 * 120 && w.status === 'playing'; i++) {
      step(w);
      peak = Math.max(peak, w.foes.length);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(FOE_CAPACITY);
  });
});

describe('foes and the end of a galaxy', () => {
  it('clears every foe for 0 points at the warp, announces each, and leaves none', () => {
    const galaxy: GalaxyDef = { ...only('1-3', 'splitter'), duration: 40 };
    const w = make(galaxy, { lives: 5 });
    const log: SimEvent[] = [];
    for (let i = 0; i < 45 * 120 && w.status !== 'cleared' && w.status !== 'gameOver'; i++) log.push(...step(w).map((e) => ({ ...e })));
    const warp = log.findIndex((e) => e.type === 'warpOut');
    expect(warp).toBeGreaterThanOrEqual(0);
    const cleared = log.slice(warp).filter((e): e is Extract<SimEvent, { type: 'foeDestroyed' }> => e.type === 'foeDestroyed');
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((e) => e.points === 0)).toBe(true);
    expect(w.foes).toEqual([]);
    expect(log.slice(warp).some((e) => e.type === 'foeSpawned')).toBe(false);
  });
});

describe('foes in other rules', () => {
  it('never appear in practice', () => {
    const w = new World({ seed: 1, field: FIELD, rules: { kind: 'practice', level: 7 } });
    for (let i = 0; i < 20 * 120 && w.status === 'playing'; i++) {
      expect(step(w).some((e) => e.type.startsWith('foe') || e.type.startsWith('well'))).toBe(false);
    }
    expect(w.foes).toEqual([]);
  });

  it('never appear in 1-1, 1-2 or Dimension 3 and on, which keep their rocks', () => {
    for (const id of ['1-1', '1-2', '3-1', '5-5'] as const) {
      const w = new World({ seed: 4, field: FIELD, rules: { kind: 'galaxy', galaxy: galaxyById(id), mode: 'rank' }, startLives: 5 });
      for (let i = 0; i < 40 * 120 && w.status === 'playing'; i++) expect(ofType(step(w), 'foeSpawned'), id).toEqual([]);
    }
  });

  it('are deterministic: the same seed brings the same events, a different seed another', () => {
    const mixed: GalaxyDef = { ...galaxyById('2-3'), kinds: { ...MUTED_KINDS, small: ALWAYS, splitter: ALWAYS, drone: ALWAYS } };
    const run = (seed: number): string => {
      const w = make(mixed, { seed, lives: 5 });
      const log: SimEvent[] = [];
      for (let i = 0; i < 60 * 120 && w.status === 'playing'; i++) log.push(...step(w).map((e) => ({ ...e })));
      return JSON.stringify(log);
    };
    expect(run(6)).toBe(run(6));
    expect(run(6)).not.toBe(run(7));
    expect(run(6)).toContain('foeSpawned');
  });
});
