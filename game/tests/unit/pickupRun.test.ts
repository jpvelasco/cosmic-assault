import { describe, expect, it } from 'vitest';
import { galaxyById, tierOf } from '../../src/content/galaxies';
import { noEffects } from '../../src/content/pickups';
import type { GalaxyDef, GalaxyId, PickupId, WeaponTier } from '../../src/content/types';
import type { AsteroidSize } from '../../src/sim/asteroid';
import { bossTarget } from '../../src/sim/boss/bossRunner';
import { PICKUP, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { PickupField } from '../../src/sim/pickups/pickups';
import { createRng, deriveSeed } from '../../src/sim/rng';
import { World, type WorldOptions } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';

const FIELD: Field = { width: 1280, height: 720 };
const FIRE: Controls = { ...NO_CONTROLS, fire: true };
const STEPS = Math.round(1 / STEP_SECONDS);
/** Faces +x along y = 360, so its shots run through the rocks a scenario puts there. */
const SHOOTER = { x: 200, y: 360, angle: 0 };

/** A galaxy whose director never spawns, so only the scenario's rocks exist. */
function calm(id: GalaxyId): GalaxyDef {
  return { ...galaxyById(id), kinds: MUTED_KINDS, events: [] };
}

type Scenario = Omit<WorldOptions, 'field' | 'seed' | 'rules'> & { readonly seed?: number; readonly mode?: 'rank' | 'free'; readonly galaxy?: GalaxyDef };

function galaxyWorld(opts: Scenario = {}): World {
  const { mode = 'free', seed = 1, galaxy = calm('2-1'), ...rest } = opts;
  return new World({ seed, field: FIELD, rules: { kind: 'galaxy', galaxy, mode }, ...rest });
}

const still = (x: number, y: number, size: AsteroidSize) => ({ x, y, size, angle: 0, speedMultiplier: 0 });

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function play(w: World, seconds: number, controls: Controls = NO_CONTROLS): SimEvent[] {
  const log: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * STEPS) && (w.status === 'playing' || w.status === 'warping'); i++) log.push(...w.step(STEP_SECONDS, controls).map((e) => ({ ...e })));
  return log;
}

/** Steps until `done` says so; returns that step's events. */
function stepUntil(w: World, controls: Controls, done: (events: readonly SimEvent[]) => boolean, maxSteps = 4000): readonly SimEvent[] {
  for (let i = 0; i < maxSteps; i++) {
    const events = w.step(STEP_SECONDS, controls);
    if (done(events)) return events;
  }
  throw new Error('condition not reached');
}

/** What the 'pickups' stream gives the first kill of the default galaxy (2-1, whose pool holds every kind) for `seed`. */
function firstRoll(seed: number, lastLife = false): PickupId | null {
  const { pickups, ...rest } = galaxyById('2-1');
  const f = new PickupField(pickups, tierOf(rest), createRng(deriveSeed(seed, 'pickups')));
  const events: SimEvent[] = [];
  f.roll(0, 0, { lastLife, weaponTier: 0 }, events);
  return f.list[0]?.kind ?? null;
}

function seedWhere(test: (seed: number) => boolean): number {
  for (let seed = 1; seed < 5000; seed++) if (test(seed)) return seed;
  throw new Error('no seed found');
}

const seedDropping = (kind: PickupId): number => seedWhere((s) => firstRoll(s) === kind);
const MISS_SEED = seedWhere((s) => firstRoll(s) === null);

/** A world whose first kill, at once, drops `kind` onto the ship: a tiny rock inside the nose. */
function droppingWorld(kind: PickupId, opts: Scenario = {}): World {
  return galaxyWorld({ seed: seedDropping(kind), initialShip: SHOOTER, initialAsteroids: [still(215, 360, 3)], ...opts });
}

/** Fires until the dropped pickup is collected. */
function collect(w: World): SimEvent[] {
  const log: SimEvent[] = [];
  stepUntil(w, FIRE, (events) => {
    log.push(...events.map((e) => ({ ...e })));
    return events.some((e) => e.type === 'pickupCollected');
  });
  return log;
}

/** Collects `kind` at the start of a run in a world with nothing else to shoot, and lets the next volley's cooldown pass. */
function equipped(kinds: readonly PickupId[], opts: Scenario = {}): World {
  const w = galaxyWorld({ initialShip: SHOOTER, ...opts });
  for (const kind of kinds) w['run']?.loadout.collect(kind);
  return w;
}

describe('a kill drops a pickup', () => {
  it('at the rock, with a kind from the galaxy pool, when the roll is under the drop chance', () => {
    const seed = seedDropping('doubleShot');
    const w = galaxyWorld({ seed, initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
    const events = stepUntil(w, FIRE, (e) => e.some((x) => x.type === 'pickupDropped'));
    expect(ofType(events, 'pickupDropped')).toEqual([{ type: 'pickupDropped', id: 1, kind: 'doubleShot', x: 300, y: 360 }]);
    expect(w.pickups).toHaveLength(1);
    // It has drifted for the rest of the step it dropped on.
    expect(w.pickups[0]).toMatchObject({ id: 1, kind: 'doubleShot' });
    expect(Math.hypot((w.pickups[0]?.x ?? 0) - 300, (w.pickups[0]?.y ?? 0) - 360)).toBeLessThan(0.5);
    expect(w.pickups[0]?.expiresIn).toBeCloseTo(PICKUP.lifespan, 1);
  });

  it('drops nothing when the roll misses', () => {
    const w = galaxyWorld({ seed: MISS_SEED, initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
    const log = play(w, 1, FIRE);
    expect(ofType(log, 'asteroidDestroyed')).toHaveLength(1);
    expect(ofType(log, 'pickupDropped')).toEqual([]);
    expect(w.pickups).toEqual([]);
  });

  it('draws only from its own stream: rocks, splits and spawns come out the same whether or not it drops', () => {
    const rocks = (seed: number) => {
      const w = galaxyWorld({ seed, initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
      play(w, 2, FIRE);
      return w.asteroids.length;
    };
    expect(rocks(seedDropping('shield'))).toBe(rocks(MISS_SEED));
  });

  it('never drops in practice, whatever the seed', () => {
    for (let seed = 1; seed < 40; seed++) {
      const w = new World({ seed, field: FIELD, rules: { kind: 'practice', level: 1 }, initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
      expect(ofType(play(w, 1, FIRE), 'asteroidDestroyed')).toHaveLength(1);
      expect(w.pickups).toEqual([]);
      expect(w.weaponTier).toBe(0);
    }
  });

  it('does not drop for a pass-through rock (a meteor or a shard)', () => {
    const w = galaxyWorld({ seed: seedDropping('shield'), initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
    (w.asteroids[0] as { transient?: true }).transient = true;
    expect(ofType(play(w, 1, FIRE), 'asteroidDestroyed')).toHaveLength(1);
    expect(w.pickups).toEqual([]);
  });

  it('does not drop for the rocks a warp clears, which score nothing', () => {
    const w = galaxyWorld({ seed: seedDropping('shield'), initialAsteroids: [still(60, 60, 3)] });
    const log = play(w, 107);
    expect(ofType(log, 'asteroidDestroyed').map((e) => e.points)).toEqual([0]);
    expect(ofType(log, 'pickupDropped')).toEqual([]);
  });

  it('does not drop for a beaten boss', () => {
    const w = galaxyWorld({ seed: seedDropping('shield'), galaxy: calm('1-6') });
    const log = play(w, 23);
    const target = () => (w.boss === null ? null : bossTarget(w.boss));
    for (let t = target(); t !== null; t = target()) w['run']?.hitBoss(t.x, t.y, 1);
    log.push(...play(w, 3));
    expect(w.boss?.hp).toBe(0);
    expect(ofType(log, 'bossDown')).toHaveLength(1);
    expect(ofType(log, 'pickupDropped')).toEqual([]);
  });

  it('holds at most 2 pickups on the field at a time', () => {
    const w = galaxyWorld({ seed: 7, galaxy: { ...calm('1-1'), kinds: { ...MUTED_KINDS, small: { from: 0, base: 1, step: 0, max: 1 } } }, mode: 'rank', startLives: 5 });
    let most = 0;
    for (let i = 0; i < 60 * STEPS; i++) {
      w.step(STEP_SECONDS, FIRE);
      most = Math.max(most, w.pickups.length);
    }
    expect(most).toBeLessThanOrEqual(PICKUP.maxOnField);
  });

  it('weights the Shield three-fold on the last life', () => {
    const seed = seedWhere((s) => firstRoll(s, false) !== 'shield' && firstRoll(s, true) === 'shield');
    const lastLife = galaxyWorld({ seed, mode: 'rank', startLives: 1, initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
    const events = stepUntil(lastLife, FIRE, (e) => e.some((x) => x.type === 'pickupDropped'));
    expect(ofType(events, 'pickupDropped')[0]?.kind).toBe('shield');
    const twoLives = galaxyWorld({ seed, mode: 'rank', startLives: 2, initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
    const other = stepUntil(twoLives, FIRE, (e) => e.some((x) => x.type === 'pickupDropped'));
    expect(ofType(other, 'pickupDropped')[0]?.kind).not.toBe('shield');
  });

  it('never drops a weapon core at the top tier, though the same seed drops one below it', () => {
    const seed = seedDropping('weaponCore');
    const kill = (startTier: WeaponTier): PickupId | undefined => {
      const w = galaxyWorld({ seed, mode: 'rank', startTier, initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
      return ofType(stepUntil(w, FIRE, (e) => e.some((x) => x.type === 'pickupDropped')), 'pickupDropped')[0]?.kind;
    };
    expect(kill(2)).toBe('weaponCore');
    const atTop = kill(3);
    expect(atTop).toBeDefined();
    expect(atTop).not.toBe('weaponCore');
  });

  it('drops no weapon core over a long run at the top tier, but other kinds', () => {
    const w = galaxyWorld({ seed: 3, galaxy: galaxyById('2-3'), mode: 'rank', startLives: 5, startTier: 3 });
    const kinds = new Set(ofType(play(w, 90, FIRE), 'pickupDropped').map((e) => e.kind));
    expect(kinds.size).toBeGreaterThan(0);
    expect(kinds.has('weaponCore')).toBe(false);
  });

  it('replays the same drops for the same seed', () => {
    const run = (seed: number) => play(galaxyWorld({ seed, galaxy: galaxyById('2-3'), mode: 'rank', startLives: 5 }), 60, FIRE).filter((e) => e.type.startsWith('pickup'));
    const a = run(3);
    expect(a.length).toBeGreaterThan(0);
    expect(run(3)).toEqual(a);
  });

  it('follows the pickups when the field resizes', () => {
    const w = galaxyWorld({ seed: seedDropping('shield'), initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3)] });
    stepUntil(w, FIRE, () => w.pickups.length > 0);
    const before = w.pickups[0]?.x ?? 0;
    w.resize({ width: 2560, height: 1440 });
    expect(w.pickups[0]?.x).toBeCloseTo(((before + 50) * 2660) / 1380 - 50, 9);
  });
});

describe('collecting a pickup', () => {
  it('takes it on contact: pickupCollected, and the field is clear', () => {
    const w = droppingWorld('doubleShot');
    const log = collect(w);
    expect(ofType(log, 'pickupDropped')).toHaveLength(1);
    expect(ofType(log, 'pickupCollected')).toEqual([{ type: 'pickupCollected', id: 1, kind: 'doubleShot' }]);
    expect(w.pickups).toEqual([]);
  });

  it('does not collect when a shot passes through it: only the ship does', () => {
    const w = galaxyWorld({ seed: seedDropping('shield'), initialShip: SHOOTER, initialAsteroids: [still(400, 360, 3)] });
    stepUntil(w, FIRE, () => w.pickups.length > 0);
    const log = play(w, 1, FIRE);
    expect(ofType(log, 'pickupCollected')).toEqual([]);
    expect(w.pickups).toHaveLength(1);
    expect(w.shield).toBe(false);
  });

  it('raises the weapon tier by one with a weapon core, and a shot per tier', () => {
    const w = droppingWorld('weaponCore');
    collect(w);
    expect(w.weaponTier).toBe(1);
    const log = play(w, 1, FIRE);
    expect(ofType(log, 'shot')).not.toHaveLength(0);
    expect(ofType(log, 'shot').length % 2).toBe(0);
    expect(w.effects).toEqual(noEffects());
  });

  it('caps the weapon tier at 3', () => {
    const w = equipped(['weaponCore', 'weaponCore', 'weaponCore', 'weaponCore', 'weaponCore']);
    expect(w.weaponTier).toBe(3);
  });

  it.each([
    ['doubleShot', 12],
    ['spreadLaser', 12],
    ['rapidFire', 12],
    ['shield', 15],
  ] as const)('starts %s for %i s, and ends it with one effectEnded', (kind, seconds) => {
    const w = droppingWorld(kind);
    collect(w);
    expect(w.effects[kind]).toBeGreaterThan(seconds - 0.1);
    const log = play(w, seconds + 1);
    expect(ofType(log, 'effectEnded')).toEqual([{ type: 'effectEnded', kind }]);
    expect(w.effects[kind]).toBe(0);
  });

  it('refreshes a kind it already has to a full timer, and never stacks it', () => {
    const w = equipped(['doubleShot']);
    play(w, 8);
    expect(w.effects.doubleShot).toBeCloseTo(4, 1);
    w['run']?.loadout.collect('doubleShot');
    expect(w.effects.doubleShot).toBe(12);
    expect(ofType(w.step(STEP_SECONDS, FIRE), 'shot')).toHaveLength(2);
    expect(play(w, 12)).toContainEqual({ type: 'effectEnded', kind: 'doubleShot' });
  });
});

describe('pickups and the warp', () => {
  /** Puts a pickup of `kind` at (x, y), standing still with its full time to live, as a kill's drop would be. */
  function place(w: World, kind: PickupId, x: number, y: number): number {
    const field = w['run']?.['pickupField'];
    if (field === undefined) throw new Error('not a galaxy run');
    const id = 900 + field.list.length;
    field.list.push({ id, kind, x, y, px: x, py: y, vx: 0, vy: 0, expiresIn: PICKUP.lifespan });
    return id;
  }

  it('expires every pickup on the field as the warp starts, reporting each', () => {
    const w = galaxyWorld({ galaxy: { ...calm('2-1'), duration: 2 }, initialShip: SHOOTER });
    play(w, 1);
    const ids = [place(w, 'weaponCore', 900, 100), place(w, 'shield', 1000, 600)];
    const warp = stepUntil(w, NO_CONTROLS, (events) => events.some((e) => e.type === 'warpOut'));
    expect(ofType(warp, 'pickupExpired').map((e) => e.id)).toEqual(ids);
    expect(w.pickups).toEqual([]);
  });

  it('collects nothing once the warp has started, so the tier the clear reported is the one carried', () => {
    const w = galaxyWorld({ galaxy: { ...calm('2-1'), duration: 2 }, mode: 'rank', initialShip: SHOOTER });
    const cleared = ofType(stepUntil(w, NO_CONTROLS, (events) => events.some((e) => e.type === 'galaxyCleared')), 'galaxyCleared');
    expect(cleared).toHaveLength(1);
    place(w, 'weaponCore', w.ship.x, w.ship.y);
    const during = play(w, 2);
    expect(w.status).toBe('cleared');
    expect(ofType(during, 'pickupCollected')).toEqual([]);
    expect(w.weaponTier).toBe(0);
  });
});

describe('the weapon', () => {
  const volleyAt = (w: World): number => ofType(w.step(STEP_SECONDS, FIRE), 'shot').length;

  it('fires one shot with no pickups, exactly as before', () => {
    expect(volleyAt(galaxyWorld({ initialShip: SHOOTER }))).toBe(1);
  });

  it('fires a pair 6 units either side of the nose with Double Shot', () => {
    const w = equipped(['doubleShot']);
    const shots = ofType(w.step(STEP_SECONDS, FIRE), 'shot');
    expect(shots).toHaveLength(2);
    expect(Math.abs((shots[0]?.y ?? 0) - (shots[1]?.y ?? 0))).toBeCloseTo(12, 9);
  });

  it('fires three with Spread Laser, and five at tier 3', () => {
    expect(volleyAt(equipped(['spreadLaser']))).toBe(3);
    expect(volleyAt(equipped(['weaponCore', 'weaponCore', 'weaponCore']))).toBe(5);
  });

  it('grows with every effect, to 8 shots at most', () => {
    expect(volleyAt(equipped(['weaponCore', 'weaponCore', 'weaponCore', 'doubleShot', 'spreadLaser']))).toBe(8);
    expect(volleyAt(equipped(['weaponCore', 'weaponCore', 'weaponCore', 'doubleShot']))).toBe(6);
    expect(volleyAt(equipped(['weaponCore', 'weaponCore', 'weaponCore', 'spreadLaser']))).toBe(7);
  });

  it('fires faster with Rapid Fire: the cooldown is 0.6 of 19/60 s', () => {
    const w = equipped(['rapidFire']);
    w.step(STEP_SECONDS, FIRE);
    expect(w.ship.fireCooldown).toBeCloseTo(PLAYER.fireInterval * 0.6, 9);
    const shots = ofType(play(equipped(['rapidFire']), 3, FIRE), 'shot').length;
    const plain = ofType(play(equipped([]), 3, FIRE), 'shot').length;
    expect(shots / plain).toBeGreaterThan(1.5);
  });

  it('goes back to one shot when the effect ends', () => {
    const w = equipped(['doubleShot']);
    play(w, 13);
    expect(volleyAt(w)).toBe(1);
  });

  it('keeps a practice run firing exactly one shot', () => {
    const w = new World({ seed: 1, field: FIELD, initialShip: SHOOTER });
    expect(ofType(w.step(STEP_SECONDS, FIRE), 'shot')).toHaveLength(1);
  });
});

describe('the Shield', () => {
  /** A rock drifting onto the parked ship once its 3 s of invulnerability is over. */
  function shielded(opts: Scenario = {}): World {
    const w = equipped(['shield'], { initialAsteroids: [still(600, 360, 2)], initialShip: { x: 600, y: 360, angle: 0 }, mode: 'rank', startLives: 3, ...opts });
    return w;
  }

  it('absorbs exactly one hit: no life lost, no death counted, a shieldBroken event, and the rock breaks', () => {
    const w = shielded();
    const events = stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shieldBroken'));
    expect(events.filter((e) => e.type === 'shieldBroken' || e.type === 'shipHit').map((e) => e.type)).toEqual(['shieldBroken']);
    expect(w.lives).toBe(3);
    expect(w.deaths).toBe(0);
    expect(w.shield).toBe(false);
    expect(w.effects.shield).toBe(0);
    expect(ofType(events, 'effectEnded')).toEqual([]);
    expect(w.asteroids.length).toBeGreaterThan(0);
  });

  it('gives the ship the normal 3 s of invulnerability after the hit', () => {
    const w = shielded();
    stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shieldBroken'));
    expect(w.ship.invulnerable).toBe(true);
    expect(w.ship.invulnerableFor).toBe(PLAYER.invulnerableSeconds);
  });

  it('leaves the combo alone: it is not a death', () => {
    // A kill in the first moments, then the rock under the ship hits as its invulnerability ends.
    const w = shielded({ initialShip: SHOOTER, initialAsteroids: [still(300, 360, 3), still(200, 390, 2)] });
    (w.ship as { invulnerableFor: number }).invulnerableFor = 0.3;
    stepUntil(w, FIRE, (e) => e.some((x) => x.type === 'shieldBroken'));
    expect(w.combo).toBe(1);
  });

  it('is a real hit the second time: the next collision costs a life', () => {
    const w = shielded({ initialAsteroids: [still(600, 360, 2), still(600, 360, 2)] });
    stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shieldBroken'));
    const events = stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shipHit'));
    expect(ofType(events, 'shipHit')).toHaveLength(1);
    expect(w.lives).toBe(2);
    expect(w.deaths).toBe(1);
  });

  it('ends on its own after 15 s unhit', () => {
    const w = equipped(['shield']);
    expect(w.shield).toBe(true);
    const log = play(w, 14.5);
    expect(w.shield).toBe(true);
    expect(ofType(log, 'effectEnded')).toEqual([]);
    expect(ofType(play(w, 1), 'effectEnded')).toEqual([{ type: 'effectEnded', kind: 'shield' }]);
    expect(w.shield).toBe(false);
  });
});

describe('losing a life', () => {
  function hitWorld(kinds: readonly PickupId[], opts: Scenario = {}): World {
    return equipped(kinds, { initialAsteroids: [still(600, 360, 2)], initialShip: { x: 600, y: 360, angle: 0 }, ...opts });
  }

  it('clears every timed effect, reporting each ended, and the volley goes back to plain', () => {
    const w = hitWorld(['doubleShot', 'rapidFire', 'spreadLaser']);
    const events = stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shipHit'));
    expect(ofType(events, 'effectEnded').map((e) => e.kind)).toEqual(['doubleShot', 'rapidFire', 'spreadLaser']);
    expect(w.effects).toEqual(noEffects());
    const shots = ofType(w.step(STEP_SECONDS, FIRE), 'shot');
    expect(shots).toHaveLength(1);
  });

  it('in Rank drops the weapon tier by one', () => {
    const w = hitWorld(['weaponCore', 'weaponCore'], { mode: 'rank', startLives: 3 });
    stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shipHit'));
    expect(w.weaponTier).toBe(1);
  });

  it('in Rank stops the tier at 0', () => {
    const w = hitWorld([], { mode: 'rank', startLives: 3 });
    stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shipHit'));
    expect(w.weaponTier).toBe(0);
  });

  it('in Free play keeps the tier, which only resets with the next galaxy', () => {
    const w = hitWorld(['weaponCore', 'weaponCore'], { mode: 'free' });
    stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'shipHit'));
    expect(w.weaponTier).toBe(2);
  });

  it('on the last life reports the dropped tier with the game over', () => {
    const w = hitWorld(['weaponCore', 'weaponCore', 'weaponCore'], { mode: 'rank', startLives: 1 });
    const events = stepUntil(w, NO_CONTROLS, (e) => e.some((x) => x.type === 'gameOver'));
    expect(ofType(events, 'shipHit')).toHaveLength(1);
    expect(w.status).toBe('gameOver');
    expect(w.weaponTier).toBe(2);
  });
});

describe('the starting weapon tier', () => {
  it.each([0, 1, 2, 3] as const)('starts a Rank galaxy at tier %i', (startTier) => {
    const w = galaxyWorld({ mode: 'rank', startTier, initialShip: SHOOTER });
    expect(w.weaponTier).toBe(startTier);
    expect(ofType(w.step(STEP_SECONDS, FIRE), 'shot')).toHaveLength([1, 2, 3, 5][startTier] ?? 0);
  });

  it('defaults to 0, and Free play can only start at 0', () => {
    expect(galaxyWorld({ mode: 'rank' }).weaponTier).toBe(0);
    expect(galaxyWorld({ mode: 'free', startTier: 0 }).weaponTier).toBe(0);
    expect(() => galaxyWorld({ mode: 'free', startTier: 1 })).toThrow(/Free play always starts at weapon tier 0.*rank/);
  });

  it.each([-1, 4, 1.5, Number.NaN])('refuses a tier of %s, saying what is allowed', (startTier) => {
    expect(() => galaxyWorld({ mode: 'rank', startTier: startTier as WeaponTier })).toThrow(/startTier must be an integer from 0 to 3/);
  });

  it('is for galaxy rules only', () => {
    expect(() => new World({ seed: 1, field: FIELD, rules: { kind: 'practice', level: 1 }, startTier: 1 })).toThrow(/startTier.*galaxy/);
    expect(() => new World({ seed: 1, field: FIELD, startTier: 0 })).toThrow(/startTier.*galaxy/);
  });
});

describe('a Dimension\'s opening galaxy', () => {
  it('hands its featured pickups to its drops, and a later galaxy features none', () => {
    const opening = galaxyWorld({ galaxy: calm('3-1') });
    expect(opening['run']?.['pickupField']['featured']).toEqual(['piercingBeam', 'homingMissiles']);
    expect(galaxyWorld({ galaxy: calm('3-2') })['run']?.['pickupField']['featured']).toEqual([]);
  });
});

describe('the pickups a world exposes', () => {
  it('has none, no tier and no effects outside a galaxy', () => {
    const w = new World({ seed: 1, field: FIELD });
    expect([w.pickups, w.weaponTier, w.shield]).toEqual([[], 0, false]);
    expect(w.effects).toEqual(noEffects());
  });
});
