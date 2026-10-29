import { devices } from '@playwright/test';
import {
  CACHE_HOLD_SECONDS,
  CACHE_LIVES,
  CLEAR_1_1_SECONDS,
  DAILY_CLEAR_SECONDS,
  DAILY_GAME_OVER_SECONDS,
  DATE_EPOCH,
  PHONE_VIEWPORT,
  E2E_DATES,
  WATCH_LIVES,
  CRIMSON_WATCH_SECONDS,
  GUNSHIP_WATCH_SECONDS,
  E2E_SEEDS,
  entryFor,
  FREE_GAME_OVER_SECONDS,
  HANGAR_OPENS_SECONDS,
  HOLE_DEATH_SECONDS,
  HULL_FIRE_SECONDS,
  PERF_FIGHT_HOLD_SECONDS,
  PERF_FIGHT_LIVES,
  PERF_HOLD_SECONDS,
  PERF_SETTLE_SECONDS,
  THREE_DEATHS_SECONDS,
  TO_BOSS_FIGHT_SECONDS,
  warnedSeconds,
  WELL_WARNING_SECONDS,
  type ClaimId,
  type DateClaimId,
  type DateEntry,
  type SeedEntry,
} from '../../e2e/seeds';
import { ATTRACT_DEMOS, DEMO_SECONDS, type AttractDemo } from '../../src/app/attract';
import { runGalaxy } from '../../src/bot/run';
import { nextDate } from '../../src/meta/calendar';
import { dailyGalaxy } from '../../src/meta/dailyGalaxy';
import { galaxyById } from '../../src/content/galaxies';
import { BLACK_HOLE } from '../../src/content/hazards';
import type { GalaxyId, HazardType } from '../../src/content/types';
import { PLAYER, PROJECTILE, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import { fieldForViewport, type Field } from '../../src/sim/field';
import type { GalaxyMode } from '../../src/sim/scoring';
import type { SimEvent } from '../../src/sim/events';
import { hasEnded, World } from '../../src/sim/world';
import { datesFrom } from './dates';

/** The fire assertions finish within about 1 s of a run starting; this leaves slow CI hosts headroom. */
const GUARD_SECONDS = 2.5;
/** The game-over specs wait for the idle ship's only life to go; past this they are slow to reach the card. */
export const MAX_DEATH_SECONDS = 8;
/** The boss specs play a little in real time before they fast-forward to the fight; the ship must outlive that too. */
export const FIGHT_SLACK_SECONDS = 3;
/** Rocks alive at the end of the perf hold for the field to count as busy. */
const BUSY_ROCKS = 14;

interface Lane {
  readonly name: string;
  readonly field: Field;
  /** Distance from the lane's centre line, for an asteroid at (x, y) in a field whose ship starts at its centre. */
  readonly offset: (x: number, y: number, field: Field) => number;
}

const pixel5 = devices['Pixel 5 landscape'].viewport;
/** The chromium-desktop project's field, where the Rank specs run. */
const DESKTOP_FIELD = fieldForViewport(1280, 720);
const LANES: readonly Lane[] = [
  // keyboard.spec.ts fires straight up from the start pose.
  { name: 'desktop, straight up', field: DESKTOP_FIELD, offset: (x, _y, f) => x - f.width / 2 },
  // touch.spec.ts fires while the stick holds the ship at angle 0, so its shots keep to the centre row.
  { name: 'phone, straight right', field: fieldForViewport(pixel5.width, pixel5.height), offset: (_x, y, f) => y - f.height / 2 },
];
const FIELDS: readonly Field[] = LANES.map((lane) => lane.field);

function newWorld(seed: number, field: Field, galaxy: GalaxyId, mode: GalaxyMode, startLives = 3): World {
  return new World({ seed, field, rules: { kind: 'galaxy', galaxy: galaxyById(galaxy), mode }, startLives });
}

const FIRE: Controls = { ...NO_CONTROLS, fire: true };

/** Steps `world` with `controls` until `stop` holds or `seconds` pass; returns the sim seconds it ran. */
function run(world: World, seconds: number, stop: () => boolean = () => false, controls: Controls = NO_CONTROLS): number {
  let step = 0;
  while (step * STEP_SECONDS < seconds && !stop()) {
    world.step(STEP_SECONDS, controls);
    step++;
  }
  return step * STEP_SECONDS;
}

/** Whether an idle ship with `lives` in a Rank run of `galaxy` loses them all on `field` within `within` sim seconds. */
function loses(seed: number, field: Field, galaxy: GalaxyId, mode: GalaxyMode, lives: number, within: number): boolean {
  const world = newWorld(seed, field, galaxy, mode, lives);
  run(world, within, () => world.status === 'gameOver');
  return world.status === 'gameOver';
}

/** No asteroid in `galaxy` ever overlaps the lane for the first GUARD_SECONDS of an idle Free play run. */
function lanesStayClear(seed: number, galaxy: GalaxyId, lane: Lane): boolean {
  const world = newWorld(seed, lane.field, galaxy, 'free');
  for (let t = 0; t < GUARD_SECONDS; t += STEP_SECONDS) {
    world.step(STEP_SECONDS, NO_CONTROLS);
    if (world.asteroids.some((a) => Math.abs(lane.offset(a.x, a.y, lane.field)) < a.radius + PROJECTILE.radius)) return false;
  }
  return true;
}

/** An idle ship (in Free play unless `mode` says otherwise) finds the boss fighting at TO_BOSS_FIGHT_SECONDS and is still alive FIGHT_SLACK_SECONDS later. */
function reachesBossFight(seed: number, galaxy: GalaxyId, field: Field, mode: GalaxyMode = 'free'): boolean {
  const world = newWorld(seed, field, galaxy, mode);
  run(world, TO_BOSS_FIGHT_SECONDS, () => world.status !== 'playing');
  if (world.boss?.state !== 'fighting') return false;
  run(world, FIGHT_SLACK_SECONDS, () => world.status !== 'playing');
  return world.status === 'playing';
}

/**
 * A ship in Free play that has reached the boss fight and holds fire for HULL_FIRE_SECONDS has a shot deflected by the
 * boss's shut hangar and leaves its HP alone; idle again, it sees the hangar open within HANGAR_OPENS_SECONDS and is
 * still alive FIGHT_SLACK_SECONDS later (the spec plays a little in real time).
 */
function opensHangar(seed: number, galaxy: GalaxyId, field: Field): boolean {
  const world = newWorld(seed, field, galaxy, 'free');
  run(world, TO_BOSS_FIGHT_SECONDS, () => world.status !== 'playing');
  const boss = world.boss;
  if (boss?.state !== 'fighting' || boss.vulnerable) return false;
  const maxHp = boss.maxHp;
  let deflected = 0;
  for (let t = 0; t < HULL_FIRE_SECONDS && world.status === 'playing'; t += STEP_SECONDS) {
    deflected += world.step(STEP_SECONDS, FIRE).filter((event) => event.type === 'bossDeflected').length;
  }
  if (deflected === 0 || boss.hp !== maxHp) return false;
  run(world, HANGAR_OPENS_SECONDS, () => boss.vulnerable || world.status !== 'playing');
  if (world.boss?.vulnerable !== true) return false;
  run(world, FIGHT_SLACK_SECONDS, () => world.status !== 'playing');
  return world.status === 'playing';
}

/**
 * An idle Free play ship is alive WELL_WARNING_SECONDS in with the galaxy's gravity well in its warning, and keeps a
 * foe on the field and its life through the next FIGHT_SLACK_SECONDS (the spec plays a little in real time first); it is
 * still alive then, with the well pulling.
 */
function seesIonReach(seed: number, galaxy: GalaxyId, field: Field): boolean {
  const world = newWorld(seed, field, galaxy, 'free');
  run(world, WELL_WARNING_SECONDS, () => world.status !== 'playing');
  const stage = (): string | undefined => world.hazards.find((h) => h.type === 'gravityWell')?.stage;
  if (stage() !== 'warning') return false;
  let bareSteps = 0;
  run(world, FIGHT_SLACK_SECONDS, () => {
    if (world.foes.length === 0) bareSteps++;
    return world.status !== 'playing';
  });
  return bareSteps === 0 && world.status === 'playing' && stage() === 'active';
}

/** An idle ship survives to the warp and clears the galaxy on the desktop field, in Rank and Free play. */
function clearsGalaxy(seed: number, galaxy: GalaxyId): boolean {
  return (['rank', 'free'] as const).every((mode) => {
    const world = newWorld(seed, DESKTOP_FIELD, galaxy, mode);
    run(world, CLEAR_1_1_SECONDS, () => world.status === 'gameOver');
    return world.status === 'cleared';
  });
}

/**
 * Sim seconds past a spec's hold that a ship holding PERF_CONTROLS in a boss fight must last: real key timing plays the
 * fight a little differently, and a fight this busy is chaotic, so the margin is wide.
 */
const FIGHT_MARGIN_SECONDS = 8;
/** Sim seconds the 'carrier-fight' ship holds PERF_CONTROLS in the fight: the perf spec's settle and hold, and the margin. */
const CARRIER_FIGHT_SECONDS = PERF_SETTLE_SECONDS + PERF_FIGHT_HOLD_SECONDS + FIGHT_MARGIN_SECONDS;
/** Sim seconds a '*-cache' ship holds PERF_CONTROLS in its boss fight: the sprite-cache spec's hold, and the margin. */
const CACHE_FIGHT_SECONDS = CACHE_HOLD_SECONDS + FIGHT_MARGIN_SECONDS;
/**
 * Sim seconds past the sprite-cache spec's hold that its 'cache-field' ship must last. Narrower than a fight's margin:
 * the black hole costs a still ship a life about every 3 s from 12 s on, so five lives last to about 24 s, and the
 * hold starts as the run does.
 */
const CACHE_FIELD_MARGIN_SECONDS = 2;

/** The controls the perf spec holds: fire and a left turn. */
const PERF_CONTROLS: Controls = { turn: -1, thrust: false, fire: true, stick: null };

/**
 * A ship that holds PERF_CONTROLS through the whole perf hold is in play at its end, in a field of at least BUSY_ROCKS rocks:
 * a scene that ends in game over is no busy field to measure.
 */
function fieldIsBusy(seed: number, galaxy: GalaxyId): boolean {
  const world = newWorld(seed, DESKTOP_FIELD, galaxy, 'free');
  run(world, PERF_HOLD_SECONDS, () => world.status !== 'playing', PERF_CONTROLS);
  return world.status === 'playing' && world.asteroids.length >= BUSY_ROCKS;
}

/**
 * An idle ship in a Rank run of `lives` finds the boss fighting at TO_BOSS_FIGHT_SECONDS; holding PERF_CONTROLS for
 * `seconds`, it keeps the boss fighting and itself in play at every step. Returns the most foes it saw on the field at
 * once, or -1 if the fight did not hold.
 */
function fightHeld(seed: number, galaxy: GalaxyId, lives: number, seconds: number): number {
  const world = newWorld(seed, DESKTOP_FIELD, galaxy, 'rank', lives);
  run(world, TO_BOSS_FIGHT_SECONDS, () => world.status !== 'playing');
  const fighting = (): boolean => world.status === 'playing' && world.boss?.state === 'fighting';
  if (!fighting()) return -1;
  let foes = 0;
  run(world, seconds, () => {
    foes = Math.max(foes, world.foes.length);
    return !fighting();
  }, PERF_CONTROLS);
  return fighting() ? foes : -1;
}

/** A ship holding PERF_CONTROLS from the start of a Rank run of CACHE_LIVES is in play through the sprite-cache hold and its margin. */
function cacheFieldHolds(seed: number, galaxy: GalaxyId): boolean {
  const world = newWorld(seed, DESKTOP_FIELD, galaxy, 'rank', CACHE_LIVES);
  run(world, CACHE_HOLD_SECONDS + CACHE_FIELD_MARGIN_SECONDS, () => world.status !== 'playing', PERF_CONTROLS);
  return world.status === 'playing';
}

/**
 * An idle run of `galaxy` on `field`, stepped and watched: whether the ship has been hit, and the sim seconds run. A Free
 * play run of three lives must never be hit; a Rank run of `lives` (the spec's `?lives=`) only has to stay in play.
 */
class IdleRun {
  readonly world: World;
  hit = false;
  seconds = 0;
  private readonly watchers: ((event: SimEvent) => void)[] = [];
  private readonly hitsAllowed: boolean;

  constructor(seed: number, readonly galaxy: GalaxyId, readonly field: Field, lives?: number) {
    this.world = lives === undefined ? newWorld(seed, field, galaxy, 'free') : newWorld(seed, field, galaxy, 'rank', lives);
    this.hitsAllowed = lives !== undefined;
  }

  /** Calls `watch` with every later step's events. */
  onEvent(watch: (event: SimEvent) => void): void {
    this.watchers.push(watch);
  }

  /** Steps until `seconds` into the run, or until `stop` holds after a step; true if the ship is in play (and, in Free play, was never hit). */
  until(seconds: number, stop: () => boolean = () => false, after: () => void = () => undefined): boolean {
    while (this.seconds < seconds && this.unhurt()) {
      for (const event of this.world.step(STEP_SECONDS, NO_CONTROLS)) {
        if (event.type === 'shipHit') this.hit = true;
        for (const watch of this.watchers) watch(event);
      }
      this.seconds += STEP_SECONDS;
      after();
      if (stop()) break;
    }
    return this.unhurt();
  }

  /** The stage of the run's first hazard of `type`, or undefined while there is none. */
  stageOf(type: HazardType): string | undefined {
    return this.world.hazards.find((h) => h.type === type)?.stage;
  }

  /**
   * Steps to the warning of the galaxy's first `type` hazard and FIGHT_SLACK_SECONDS on, calling `after` after every
   * step; true if the hazard was warning, then active, with the ship in play throughout.
   */
  warnsThenActs(type: HazardType, after?: () => void): boolean {
    const warned = warnedSeconds(this.galaxy, type);
    return this.until(warned, undefined, after) && this.stageOf(type) === 'warning' && this.until(warned + FIGHT_SLACK_SECONDS, undefined, after) && this.stageOf(type) === 'active';
  }

  private unhurt(): boolean {
    return this.world.status === 'playing' && (this.hitsAllowed || !this.hit);
  }
}

/** Whether the bolt lies across the field's edge, partly out of it: a bolt leaves the field, so it is on its way off. */
const acrossEdge = ({ x, y, radius }: Readonly<{ x: number; y: number; radius: number }>, field: Field): boolean =>
  x < radius || x > field.width - radius || y < radius || y > field.height - radius;

/** What an idle run has seen of the foes' telegraphed attacks and of its bolts, as the hazard spec watches for them. */
interface Sightings {
  /** A gunship wound up, then fired a bolt. */
  aimedBolt: boolean;
  /** The first mine seen arming blasted, and no other mine blasted before it. */
  blast: boolean;
  /** A bolt lay across the field's edge, on its way out. */
  edge: boolean;
}

/** Watches `idle` from now on for what `Sightings` lists, returning the record it keeps up to date and the check that updates its `edge`. */
function watchSightings(idle: IdleRun): { seen: Sightings; afterStep: () => void } {
  const { world, field } = idle;
  const woundUp = new Set<number>();
  let firstArmed: number | null = null;
  let blasted = false;
  const seen: Sightings = { aimedBolt: false, blast: false, edge: false };
  idle.onEvent((event) => {
    if (event.type === 'foeWindup' && world.foes.some((foe) => foe.id === event.id && foe.kind === 'gunship')) woundUp.add(event.id);
    else if (event.type === 'boltFired' && event.source === 'gunship' && woundUp.has(event.owner)) seen.aimedBolt = true;
    else if (event.type === 'mineArmed') firstArmed ??= event.id;
    else if (event.type === 'mineBlast' && firstArmed !== null && !blasted) {
      blasted = true;
      seen.blast = event.id === firstArmed;
    }
  });
  return {
    seen,
    afterStep: () => {
      if (world.bolts.some((bolt) => acrossEdge(bolt, field))) seen.edge = true;
    },
  };
}

/** Steps `idle` until `wanted` holds or `seconds` pass; true if it held with the ship in play. */
function sees(idle: IdleRun, seconds: number, wanted: () => boolean, afterStep: () => void): boolean {
  return idle.until(seconds, wanted, afterStep) && wanted();
}

/**
 * An idle ship in a Rank run of `galaxy` on `field` with WATCH_LIVES lives: in play at its danger zone's warning, and
 * FIGHT_SLACK_SECONDS on with the zone active; then, by CRIMSON_WATCH_SECONDS and still in play, it has seen the first mine
 * to arm be the first to blast.
 */
function seesZoneAndMine(seed: number, galaxy: GalaxyId, field: Field): boolean {
  const idle = new IdleRun(seed, galaxy, field, WATCH_LIVES);
  const { seen, afterStep } = watchSightings(idle);
  return idle.warnsThenActs('dangerZone', afterStep) && sees(idle, CRIMSON_WATCH_SECONDS, () => seen.blast, afterStep);
}

/**
 * An idle ship in a Rank run of `galaxy` on `field` with WATCH_LIVES lives has seen, by GUNSHIP_WATCH_SECONDS and still
 * in play, a gunship wind up and then fire, and a bolt cross the field's edge on its way out.
 */
function seesGunshipBolt(seed: number, galaxy: GalaxyId, field: Field): boolean {
  const idle = new IdleRun(seed, galaxy, field, WATCH_LIVES);
  const { seen, afterStep } = watchSightings(idle);
  return sees(idle, GUNSHIP_WATCH_SECONDS, () => seen.aimedBolt && seen.edge, afterStep);
}

/**
 * An idle Free play ship is alive and never hit at the black hole's warning; it loses its first life to the hole's
 * horizon within HOLE_DEATH_SECONDS, and comes back at least the hole's exit reach from it, the run still in play.
 */
function respawnsClearOfHole(seed: number, galaxy: GalaxyId): boolean {
  const idle = new IdleRun(seed, galaxy, DESKTOP_FIELD);
  if (!idle.until(warnedSeconds(galaxy, 'blackHole')) || idle.stageOf('blackHole') !== 'warning') return false;
  const hits: { x: number; y: number }[] = [];
  idle.onEvent((event) => {
    if (event.type === 'shipHit') hits.push({ x: event.x, y: event.y });
  });
  idle.until(HOLE_DEATH_SECONDS, () => idle.hit);
  const [lostAt] = hits;
  const hole = idle.world.hazards.find((h) => h.type === 'blackHole');
  if (lostAt === undefined || hole?.stage !== 'active' || idle.world.status !== 'playing') return false;
  const { x, y } = lostAt;
  const { ship } = idle.world;
  return Math.hypot(x - hole.x, y - hole.y) <= BLACK_HOLE.horizon + PLAYER.radius + 1 && Math.hypot(ship.x - hole.x, ship.y - hole.y) >= BLACK_HOLE.exitReach;
}

/** What the seed of one table entry promises, and the check that it still does. */
interface Claim {
  /** Finishes "seed N no longer ...", for the failure message. */
  readonly promise: (galaxy: GalaxyId) => string;
  readonly holds: (seed: number, galaxy: GalaxyId) => boolean;
}

/** The claim of a boss spec that fights in Free play on the desktop field. */
const DESKTOP_BOSS_FIGHT: Claim = {
  promise: (galaxy) => `keeps an idle Free play ship alive through ${galaxy}'s approach and intro to the boss fight (fighting at ${String(TO_BOSS_FIGHT_SECONDS)} s, ship alive ${String(FIGHT_SLACK_SECONDS)} s later) on the desktop field`,
  holds: (seed, galaxy) => reachesBossFight(seed, galaxy, DESKTOP_FIELD),
};

/** The claim of a sprite-cache boss scene. */
const CACHE_FIGHT: Claim = {
  promise: (galaxy) => `keeps ${galaxy}'s boss fighting through ${String(CACHE_FIGHT_SECONDS)} s of fire and a left turn from the fight's start (${String(TO_BOSS_FIGHT_SECONDS)} s, idle until then), the ship in play throughout with ${String(CACHE_LIVES)} lives, on the desktop field`,
  holds: (seed, galaxy) => fightHeld(seed, galaxy, CACHE_LIVES, CACHE_FIGHT_SECONDS) >= 0,
};

export const CLAIMS: Readonly<Record<ClaimId, Claim>> = {
  'lanes-clear': {
    promise: (galaxy) => `keeps ${galaxy}'s rocks out of the e2e firing lanes for the first ${String(GUARD_SECONDS)} s (the keyboard and touch specs shoot through them)`,
    holds: (seed, galaxy) => LANES.every((lane) => lanesStayClear(seed, galaxy, lane)),
  },
  'boss-fight': {
    promise: (galaxy) => `keeps an idle ship alive through ${galaxy}'s approach and intro to the boss fight (fighting at ${String(TO_BOSS_FIGHT_SECONDS)} s, ship alive ${String(FIGHT_SLACK_SECONDS)} s later) on both e2e fields`,
    holds: (seed, galaxy) => FIELDS.every((field) => reachesBossFight(seed, galaxy, field)),
  },
  'hangar-opens': {
    promise: (galaxy) => `has an idle ship in ${galaxy} reach the boss fight, turn a shot away from the shut hangar with its HP untouched in ${String(HULL_FIRE_SECONDS)} s of fire, see the hangar open within ${String(HANGAR_OPENS_SECONDS)} s, and live ${String(FIGHT_SLACK_SECONDS)} s on, on the desktop field`,
    holds: (seed, galaxy) => opensHangar(seed, galaxy, DESKTOP_FIELD),
  },
  'ion-reach-hazards': {
    promise: (galaxy) => `keeps an idle Free play ship alive ${String(WELL_WARNING_SECONDS)} s into ${galaxy}, with its gravity well telegraphed, with a foe on the field and the ship alive ${String(FIGHT_SLACK_SECONDS)} s on, the well pulling, on the desktop field`,
    holds: (seed, galaxy) => seesIonReach(seed, galaxy, DESKTOP_FIELD),
  },
  'clears-1-1': {
    promise: (galaxy) => `lets an idle ship clear ${galaxy} on the desktop field, in Rank and Free play, within ${String(CLEAR_1_1_SECONDS)} s`,
    holds: clearsGalaxy,
  },
  'one-life-death': {
    promise: (galaxy) => `ends a one-life idle run in ${galaxy} within ${String(MAX_DEATH_SECONDS)} s on both e2e fields`,
    holds: (seed, galaxy) => FIELDS.every((field) => loses(seed, field, galaxy, 'rank', 1, MAX_DEATH_SECONDS)),
  },
  'three-deaths': {
    promise: (galaxy) => `loses all three lives of an idle Rank run in ${galaxy} within ${String(THREE_DEATHS_SECONDS)} s on the desktop field`,
    holds: (seed, galaxy) => loses(seed, DESKTOP_FIELD, galaxy, 'rank', 3, THREE_DEATHS_SECONDS),
  },
  'free-game-over': {
    promise: (galaxy) => `loses all three lives of an idle Free play run in ${galaxy} within ${String(FREE_GAME_OVER_SECONDS)} s on the desktop field`,
    holds: (seed, galaxy) => loses(seed, DESKTOP_FIELD, galaxy, 'free', 3, FREE_GAME_OVER_SECONDS),
  },
  'busy-field': {
    promise: (galaxy) => `leaves ${String(BUSY_ROCKS)} or more rocks in ${galaxy} after ${String(PERF_HOLD_SECONDS)} s with the ship firing and turning, in play throughout`,
    holds: fieldIsBusy,
  },
  'carrier-fight': {
    promise: (galaxy) => `keeps ${galaxy}'s boss fighting, with drones out, through ${String(CARRIER_FIGHT_SECONDS)} s of fire and a left turn from the fight's start (${String(TO_BOSS_FIGHT_SECONDS)} s, idle until then), the ship in play throughout with ${String(PERF_FIGHT_LIVES)} lives, on the desktop field`,
    holds: (seed, galaxy) => fightHeld(seed, galaxy, PERF_FIGHT_LIVES, CARRIER_FIGHT_SECONDS) > 0,
  },
  'crimson-hazards': {
    promise: (galaxy) => `keeps an idle ship in a Rank run of ${galaxy} with ${String(WATCH_LIVES)} lives in play to its danger zone's warning, on into the zone, and on until it sees the first mine to arm be the first to blast within ${String(CRIMSON_WATCH_SECONDS)} s, on both e2e fields`,
    holds: (seed, galaxy) => FIELDS.every((field) => seesZoneAndMine(seed, galaxy, field)),
  },
  'gunship-bolt': {
    promise: (galaxy) => `keeps an idle ship in a Rank run of ${galaxy} with ${String(WATCH_LIVES)} lives in play until it sees a gunship wind up then fire, and a bolt cross the field's edge, within ${String(GUNSHIP_WATCH_SECONDS)} s, on both e2e fields`,
    holds: (seed, galaxy) => FIELDS.every((field) => seesGunshipBolt(seed, galaxy, field)),
  },
  'void-rift': {
    promise: (galaxy) => `keeps an idle Free play ship in ${galaxy} unhit to its warp rift's warning and ${String(FIGHT_SLACK_SECONDS)} s on with the rift open, on the desktop field`,
    holds: (seed, galaxy) => new IdleRun(seed, galaxy, DESKTOP_FIELD).warnsThenActs('warpRift'),
  },
  'singularity-hole': {
    promise: (galaxy) => `keeps an idle Free play ship in ${galaxy} unhit to its black hole's warning, then loses its first life to the hole within ${String(HOLE_DEATH_SECONDS)} s and brings it back at least ${String(BLACK_HOLE.exitReach)} from it, on the desktop field`,
    holds: respawnsClearOfHole,
  },
  'warden-fight': DESKTOP_BOSS_FIGHT,
  'leviathan-fight': DESKTOP_BOSS_FIGHT,
  'eclipse-rank': {
    promise: (galaxy) => `keeps an idle ship in a Rank run of three lives alive through ${galaxy}'s approach and intro to the boss fight (fighting at ${String(TO_BOSS_FIGHT_SECONDS)} s, ship alive ${String(FIGHT_SLACK_SECONDS)} s later) on the desktop field`,
    holds: (seed, galaxy) => reachesBossFight(seed, galaxy, DESKTOP_FIELD, 'rank'),
  },
  'cache-field': {
    promise: (galaxy) => `keeps a ship firing and turning from the start of a Rank run of ${galaxy} with ${String(CACHE_LIVES)} lives in play for ${String(CACHE_HOLD_SECONDS + CACHE_FIELD_MARGIN_SECONDS)} s, on the desktop field`,
    holds: cacheFieldHolds,
  },
  'warden-cache': CACHE_FIGHT,
  'leviathan-cache': CACHE_FIGHT,
  'eclipse-cache': CACHE_FIGHT,
};

/** The failure message for an entry whose claim no longer holds: what broke, and the command that re-picks the seed. */
export function unmetClaimMessage({ seed, claim, galaxy }: SeedEntry): string {
  return `seed ${String(seed)} no longer ${CLAIMS[claim].promise(galaxy)}, because spawning, RNG consumption, pacing or balance changed; run: npm run find-seeds -- ${claim}, then set the "${claim}" seed in game/e2e/seeds.ts to the lowest one it lists`;
}

/** The claims a table lists, in table order. */
export function claimIds(): ClaimId[] {
  return E2E_SEEDS.map((entry) => entry.claim);
}

export interface FindOptions {
  /** First seed to try (default 1). */
  readonly from?: number;
  /** How many seeds to list (default 5). */
  readonly count?: number;
  /** Stop before this seed (default 2000). */
  readonly to?: number;
}

/** The lowest numbers from `from` (and below `to`) for which `holds`, lowest first: seeds, or days after DATE_EPOCH. */
function lowestHolding(holds: (n: number) => boolean, { from = 1, count = 5, to = 2000 }: FindOptions): number[] {
  const found: number[] = [];
  for (let n = from; n < to && found.length < count; n++) {
    if (holds(n)) found.push(n);
  }
  return found;
}

/** The lowest seeds from `from` for which `claim` holds in its table galaxy, lowest first. */
export function findSeeds(claim: ClaimId, options: FindOptions = {}): number[] {
  const { galaxy } = entryFor(claim);
  return lowestHolding((seed) => CLAIMS[claim].holds(seed, galaxy), options);
}

/** The claim an attract demo's seed makes, named after its galaxy. */
export type DemoClaimId = `attract-${GalaxyId}`;

/** The field shapes a demo must hold at: the 16:9 reference and the narrowest and widest the game plays at. */
const DEMO_ASPECTS: readonly (readonly [name: string, aspect: number])[] = [
  ['16:9', 16 / 9],
  ['4:3', 4 / 3],
  ['21:9', 21 / 9],
];

/** The claim of the demo of `galaxy`. */
const demoClaimOf = (galaxy: GalaxyId): DemoClaimId => `attract-${galaxy}`;

/** The claims of the attract demos, in the order they play. */
export function demoClaimIds(): DemoClaimId[] {
  return ATTRACT_DEMOS.map((demo) => demoClaimOf(demo.galaxy));
}

/** The galaxy a demo claim is about; throws for a claim no demo makes. */
function demoGalaxy(claim: DemoClaimId): GalaxyId {
  const demo = ATTRACT_DEMOS.find((candidate) => demoClaimOf(candidate.galaxy) === claim);
  if (demo === undefined) throw new RangeError(`No attract demo makes the claim "${claim}"; the demos are in ATTRACT_DEMOS in src/app/attract.ts`);
  return demo.galaxy;
}

/** Whether the expert, in Free play of `galaxy` on `seed` at `aspect`, loses no life and is still in play after DEMO_SECONDS. */
function expertLivesThroughDemo(seed: number, galaxy: GalaxyId, aspect: number): boolean {
  const result = runGalaxy({ galaxy: galaxyById(galaxy), seed, profile: 'expert', aspect, maxSeconds: DEMO_SECONDS });
  return result.deaths === 0 && !result.cleared && result.time >= DEMO_SECONDS - STEP_SECONDS;
}

/** What a demo's seed promises, for the failure message. */
const demoPromise = (galaxy: GalaxyId): string =>
  `keeps the expert in a Free play run of ${galaxy} alive on its first life for the attract demo's ${String(DEMO_SECONDS)} s, at ${DEMO_ASPECTS.map(([name]) => name).join(', ')}`;

/** Whether `seed` keeps the demo claim of `galaxy` on every demo aspect. */
export function demoClaimHolds(seed: number, galaxy: GalaxyId): boolean {
  return DEMO_ASPECTS.every(([, aspect]) => expertLivesThroughDemo(seed, galaxy, aspect));
}

/** The failure message for a demo whose seed no longer keeps its claim: what broke, and the command that re-picks the seed. */
export function unmetDemoClaimMessage({ seed, galaxy }: AttractDemo): string {
  const claim = demoClaimOf(galaxy);
  return `seed ${String(seed)} no longer ${demoPromise(galaxy)}, because the expert bot, spawning, pacing or balance changed; run: npm run find-seeds -- ${claim}, then set the ${galaxy} demo's seed in ATTRACT_DEMOS (game/src/app/attract.ts) to the lowest one it lists`;
}

/** The lowest seeds from `from` that keep a demo claim, lowest first. */
export function findDemoSeeds(claim: DemoClaimId, options: FindOptions = {}): number[] {
  const galaxy = demoGalaxy(claim);
  return lowestHolding((seed) => demoClaimHolds(seed, galaxy), options);
}

/** The field of a phone on its side, where the Daily spec plays its phone clear. */
const PHONE_DAILY_FIELD = fieldForViewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

/** An idle ship in the Daily of `date`, on its own World seed, on `field`, played until it ends or `seconds` pass. */
function idleDaily(date: string, seconds: number, field: Field = DESKTOP_FIELD): World {
  const { seed, def } = dailyGalaxy(date);
  const world = new World({ seed, field, rules: { kind: 'galaxy', galaxy: def, mode: 'daily' } });
  run(world, seconds, () => hasEnded(world.status));
  return world;
}

/** Whether an idle ship clears the Daily of `date` on `field`. */
const idleClearsDaily = (date: string, field: Field = DESKTOP_FIELD): boolean => idleDaily(date, DAILY_CLEAR_SECONDS, field).status === 'cleared';

interface DateClaim {
  /** What the date promises, for the failure message. */
  readonly promise: (date: string) => string;
  readonly holds: (date: string) => boolean;
}

export const DATE_CLAIMS: Readonly<Record<DateClaimId, DateClaim>> = {
  'daily-clears': {
    promise: (date) => `lets an idle ship clear the Daily Galaxy of ${date} on the desktop field and on a phone's at 844×390`,
    holds: (date) => [DESKTOP_FIELD, PHONE_DAILY_FIELD].every((field) => idleClearsDaily(date, field)),
  },
  'daily-streak': {
    promise: (date) => `lets an idle ship clear the Daily Galaxies of ${date} and of the day after on the desktop field`,
    holds: (date) => [date, nextDate(date)].every((day) => idleClearsDaily(day)),
  },
  'daily-game-over': {
    promise: (date) => `ends an idle run of the Daily Galaxy of ${date} within ${String(DAILY_GAME_OVER_SECONDS)} s on the desktop field`,
    holds: (date) => idleDaily(date, DAILY_GAME_OVER_SECONDS).status === 'gameOver',
  },
};

/** The failure message for a date whose claim no longer holds: what broke, and the command that re-picks the date. */
export function unmetDateClaimMessage({ date, claim }: DateEntry): string {
  return `${date} no longer ${DATE_CLAIMS[claim].promise(date)}, because the Daily generator, spawning, pacing or balance changed; run: npm run find-seeds -- ${claim}, then set the "${claim}" date in game/e2e/seeds.ts to the earliest one it lists`;
}

/** The date claims the table lists, in table order. */
export function dateClaimIds(): DateClaimId[] {
  return E2E_DATES.map((entry) => entry.claim);
}

/** The earliest dates `from` days after DATE_EPOCH (and before day `to`) whose Daily keeps `claim`, earliest first. */
export function findDates(claim: DateClaimId, { from = 0, count = 5, to = 2000 }: FindOptions = {}): string[] {
  const dates = datesFrom(DATE_EPOCH, to);
  const dateOn = (day: number): string => dates[day] ?? DATE_EPOCH;
  return lowestHolding((day) => DATE_CLAIMS[claim].holds(dateOn(day)), { from, count, to }).map(dateOn);
}
