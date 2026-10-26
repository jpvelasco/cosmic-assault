import { devices } from '@playwright/test';
import { BOSS_GALAXY, E2E_GALAXY, GAME_OVER_GALAXY, THREE_DEATHS_SECONDS, TO_BOSS_FIGHT_SECONDS } from '../../e2e/seed';
import { galaxyById } from '../../src/content/galaxies';
import { PROJECTILE, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { fieldForViewport, type Field } from '../../src/sim/field';
import { World } from '../../src/sim/world';

/** The fire assertions finish within about 1 s of a run starting; this leaves slow CI hosts headroom. */
const GUARD_SECONDS = 2.5;
/** The game-over specs wait for the idle ship's only life to go; past this they are slow to reach the card. */
export const MAX_DEATH_SECONDS = 8;
/** The boss specs play a little in real time before they fast-forward to the fight; the ship must outlive that too. */
export const FIGHT_SLACK_SECONDS = 3;

export interface Lane {
  readonly name: string;
  readonly field: Field;
  /** Distance from the lane's centre line, for an asteroid at (x, y) in a field whose ship starts at its centre. */
  readonly offset: (x: number, y: number, field: Field) => number;
}

const pixel5 = devices['Pixel 5 landscape'].viewport;
/** The chromium-desktop project's field, where the Rank specs run. */
export const DESKTOP_FIELD = fieldForViewport(1280, 720);
export const LANES: readonly Lane[] = [
  // keyboard.spec.ts fires straight up from the start pose.
  { name: 'desktop, straight up', field: DESKTOP_FIELD, offset: (x, _y, f) => x - f.width / 2 },
  // touch.spec.ts fires while the stick holds the ship at angle 0, so its shots keep to the centre row.
  { name: 'phone, straight right', field: fieldForViewport(pixel5.width, pixel5.height), offset: (_x, y, f) => y - f.height / 2 },
];

/** Steps the e2e run (Free play in E2E_GALAXY) with no input and reports whether any asteroid ever overlaps the lane. */
export function lanesStayClear(seed: number, lane: Lane): boolean {
  const world = new World({ seed, field: lane.field, rules: { kind: 'galaxy', galaxy: galaxyById(E2E_GALAXY), mode: 'free' } });
  for (let t = 0; t < GUARD_SECONDS; t += STEP_SECONDS) {
    world.step(STEP_SECONDS, NO_CONTROLS);
    const crossed = world.asteroids.some(
      (a) => Math.abs(lane.offset(a.x, a.y, lane.field)) < a.radius + PROJECTILE.radius,
    );
    if (crossed) return false;
  }
  return true;
}

/** Seeds in [from, to) for which `keep` holds on every lane, lowest first. */
function seedsOnEveryLane(from: number, to: number, keep: (seed: number, lane: Lane) => boolean): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i).filter((seed) => LANES.every((lane) => keep(seed, lane)));
}

/** Steps `world` idle until `stop` holds or `seconds` pass; returns the sim seconds it ran. */
function runIdle(world: World, seconds: number, stop: () => boolean): number {
  let step = 0;
  while (step * STEP_SECONDS < seconds && !stop()) {
    world.step(STEP_SECONDS, NO_CONTROLS);
    step++;
  }
  return step * STEP_SECONDS;
}

/** Sim seconds until an idle ship with `lives` in a Rank run of GAME_OVER_GALAXY loses them all on `field`; Infinity if not within `within`. */
function idleLossSeconds(seed: number, field: Field, lives: number, within: number): number {
  const world = new World({ seed, field, rules: { kind: 'galaxy', galaxy: galaxyById(GAME_OVER_GALAXY), mode: 'rank' }, startLives: lives });
  const seconds = runIdle(world, within, () => world.status === 'gameOver');
  return world.status === 'gameOver' ? seconds : Number.POSITIVE_INFINITY;
}

/** Sim seconds until an idle ship with one life (a Rank run of GAME_OVER_GALAXY) is hit on the lane's field; Infinity if not within MAX_DEATH_SECONDS. */
export function idleDeathSeconds(seed: number, lane: Lane): number {
  return idleLossSeconds(seed, lane.field, 1, MAX_DEATH_SECONDS);
}

/** Seeds in [from, to) whose idle ship dies within MAX_DEATH_SECONDS on every e2e field, lowest first. */
function gameOverSeeds(from: number, to: number): number[] {
  return seedsOnEveryLane(from, to, (seed, lane) => idleDeathSeconds(seed, lane) <= MAX_DEATH_SECONDS);
}

/**
 * Whether an idle ship (Free play, 3 lives) in BOSS_GALAXY finds its boss fighting at TO_BOSS_FIGHT_SECONDS and is
 * still alive FIGHT_SLACK_SECONDS later, on the lane's field.
 */
export function reachesBossFight(seed: number, lane: Lane): boolean {
  const world = new World({ seed, field: lane.field, rules: { kind: 'galaxy', galaxy: galaxyById(BOSS_GALAXY), mode: 'free' } });
  runIdle(world, TO_BOSS_FIGHT_SECONDS, () => world.status !== 'playing');
  if (world.boss?.state !== 'fighting') return false;
  runIdle(world, FIGHT_SLACK_SECONDS, () => world.status !== 'playing');
  return world.status === 'playing';
}

/** Sim seconds until an idle ship with three lives (a Rank run of GAME_OVER_GALAXY) loses them all on the desktop field; Infinity if not within THREE_DEATHS_SECONDS. */
export function threeDeathSeconds(seed: number): number {
  return idleLossSeconds(seed, DESKTOP_FIELD, 3, THREE_DEATHS_SECONDS);
}

/** Seeds in [from, to) that keep every lane clear and reach the boss fight on every e2e field, lowest first: E2E_SEED candidates. */
export function e2eSeeds(from: number, to: number): number[] {
  return seedsOnEveryLane(from, to, (seed, lane) => lanesStayClear(seed, lane) && reachesBossFight(seed, lane));
}

/** Seeds in [from, to) whose idle ship dies within MAX_DEATH_SECONDS on every e2e field and loses three lives in time on the desktop field. */
export function gameOverSeedsWithThreeDeaths(from: number, to: number): number[] {
  return gameOverSeeds(from, to).filter((seed) => threeDeathSeconds(seed) <= THREE_DEATHS_SECONDS);
}
