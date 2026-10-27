import { devices } from '@playwright/test';
import { CLEAR_1_1_SECONDS, E2E_SEEDS, entryFor, FREE_GAME_OVER_SECONDS, HANGAR_OPENS_SECONDS, HULL_FIRE_SECONDS, PERF_FIGHT_HOLD_SECONDS, PERF_FIGHT_LIVES, PERF_SETTLE_SECONDS, THREE_DEATHS_SECONDS, TO_BOSS_FIGHT_SECONDS, WELL_WARNING_SECONDS, type ClaimId, type SeedEntry } from '../../e2e/seeds';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { PROJECTILE, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS, type Controls } from '../../src/sim/controls';
import { fieldForViewport, type Field } from '../../src/sim/field';
import type { GalaxyMode } from '../../src/sim/scoring';
import { World } from '../../src/sim/world';

/** The fire assertions finish within about 1 s of a run starting; this leaves slow CI hosts headroom. */
const GUARD_SECONDS = 2.5;
/** The game-over specs wait for the idle ship's only life to go; past this they are slow to reach the card. */
export const MAX_DEATH_SECONDS = 8;
/** The boss specs play a little in real time before they fast-forward to the fight; the ship must outlive that too. */
export const FIGHT_SLACK_SECONDS = 3;
/** The perf spec holds fire and a turn for this long; the claimed field is busy by then. */
const BUSY_SECONDS = 15;
/** Rocks alive after BUSY_SECONDS for the field to count as busy. */
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

/** An idle Free play ship finds the boss fighting at TO_BOSS_FIGHT_SECONDS and is still alive FIGHT_SLACK_SECONDS later. */
function reachesBossFight(seed: number, galaxy: GalaxyId, field: Field): boolean {
  const world = newWorld(seed, field, galaxy, 'free');
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
  const stage = (): string | undefined => world.well?.stage;
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
 * Sim seconds past the perf spec's settle and hold the 'carrier-fight' ship must last: real key timing plays the fight a
 * little differently, and a fight this busy is chaotic, so the margin is wide.
 */
const CARRIER_MARGIN_SECONDS = 8;
/** Sim seconds the 'carrier-fight' ship holds PERF_CONTROLS in the fight. */
const CARRIER_FIGHT_SECONDS = PERF_SETTLE_SECONDS + PERF_FIGHT_HOLD_SECONDS + CARRIER_MARGIN_SECONDS;

/** The controls the perf spec holds: fire and a left turn. */
const PERF_CONTROLS: Controls = { turn: -1, thrust: false, fire: true, stick: null };

/** A ship that holds PERF_CONTROLS is in a field of at least BUSY_ROCKS rocks. */
function fieldIsBusy(seed: number, galaxy: GalaxyId): boolean {
  const world = newWorld(seed, DESKTOP_FIELD, galaxy, 'free');
  run(world, BUSY_SECONDS, () => false, PERF_CONTROLS);
  return world.asteroids.length >= BUSY_ROCKS;
}

/**
 * An idle ship in a Rank run of PERF_FIGHT_LIVES lives finds the boss fighting at TO_BOSS_FIGHT_SECONDS; holding
 * PERF_CONTROLS for CARRIER_FIGHT_SECONDS, it keeps the boss fighting and itself in play at every step, and sees
 * drones launched.
 */
function staysInFight(seed: number, galaxy: GalaxyId): boolean {
  const world = newWorld(seed, DESKTOP_FIELD, galaxy, 'rank', PERF_FIGHT_LIVES);
  run(world, TO_BOSS_FIGHT_SECONDS, () => world.status !== 'playing');
  const fighting = (): boolean => world.status === 'playing' && world.boss?.state === 'fighting';
  if (!fighting()) return false;
  let drones = 0;
  run(world, CARRIER_FIGHT_SECONDS, () => {
    drones = Math.max(drones, world.foes.length);
    return !fighting();
  }, PERF_CONTROLS);
  return fighting() && drones > 0;
}

/** What the seed of one table entry promises, and the check that it still does. */
interface Claim {
  /** Finishes "seed N no longer ...", for the failure message. */
  readonly promise: (galaxy: GalaxyId) => string;
  readonly holds: (seed: number, galaxy: GalaxyId) => boolean;
}

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
    promise: (galaxy) => `leaves ${String(BUSY_ROCKS)} or more rocks in ${galaxy} after ${String(BUSY_SECONDS)} s with the ship firing and turning`,
    holds: fieldIsBusy,
  },
  'carrier-fight': {
    promise: (galaxy) => `keeps ${galaxy}'s boss fighting, with drones out, through ${String(CARRIER_FIGHT_SECONDS)} s of fire and a left turn from the fight's start (${String(TO_BOSS_FIGHT_SECONDS)} s, idle until then), the ship in play throughout with ${String(PERF_FIGHT_LIVES)} lives, on the desktop field`,
    holds: staysInFight,
  },
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

/** The lowest seeds from `from` for which `claim` holds in its table galaxy, lowest first. */
export function findSeeds(claim: ClaimId, { from = 1, count = 5, to = 2000 }: FindOptions = {}): number[] {
  const { galaxy } = entryFor(claim);
  const found: number[] = [];
  for (let seed = from; seed < to && found.length < count; seed++) {
    if (CLAIMS[claim].holds(seed, galaxy)) found.push(seed);
  }
  return found;
}
