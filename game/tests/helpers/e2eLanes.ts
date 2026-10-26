import { devices } from '@playwright/test';
import { E2E_GALAXY, GAME_OVER_GALAXY } from '../../e2e/seed';
import { galaxyById } from '../../src/content/galaxies';
import { PROJECTILE, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { fieldForViewport, type Field } from '../../src/sim/field';
import { World } from '../../src/sim/world';

/** The fire assertions finish within about 1 s of a run starting; this leaves slow CI hosts headroom. */
const GUARD_SECONDS = 2.5;
/** The game-over specs wait for the idle ship's only life to go; past this they are slow to reach the card. */
export const MAX_DEATH_SECONDS = 8;

export interface Lane {
  readonly name: string;
  readonly field: Field;
  /** Distance from the lane's centre line, for an asteroid at (x, y) in a field whose ship starts at its centre. */
  readonly offset: (x: number, y: number, field: Field) => number;
}

const pixel5 = devices['Pixel 5 landscape'].viewport;
export const LANES: readonly Lane[] = [
  // keyboard.spec.ts fires straight up from the start pose.
  { name: 'desktop, straight up', field: fieldForViewport(1280, 720), offset: (x, _y, f) => x - f.width / 2 },
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

/** Seeds in [from, to) that keep every lane clear, lowest first. */
export function clearSeeds(from: number, to: number): number[] {
  return seedsOnEveryLane(from, to, lanesStayClear);
}

/** Sim seconds until an idle ship with one life (a Rank run of GAME_OVER_GALAXY) is hit on the lane's field; Infinity if not within MAX_DEATH_SECONDS. */
export function idleDeathSeconds(seed: number, lane: Lane): number {
  const world = new World({ seed, field: lane.field, rules: { kind: 'galaxy', galaxy: galaxyById(GAME_OVER_GALAXY), mode: 'rank' }, startLives: 1 });
  for (let step = 1; step * STEP_SECONDS <= MAX_DEATH_SECONDS; step++) {
    world.step(STEP_SECONDS, NO_CONTROLS);
    if (world.status === 'gameOver') return step * STEP_SECONDS;
  }
  return Number.POSITIVE_INFINITY;
}

/** Seeds in [from, to) whose idle ship dies within MAX_DEATH_SECONDS on every e2e field, lowest first. */
export function gameOverSeeds(from: number, to: number): number[] {
  return seedsOnEveryLane(from, to, (seed, lane) => idleDeathSeconds(seed, lane) <= MAX_DEATH_SECONDS);
}
