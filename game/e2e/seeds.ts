import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../src/content/pacingRules';
import type { GalaxyId } from '../src/content/types';

/** One seed and the claim it makes about its idle ship in `galaxy`. */
export interface SeedEntry {
  readonly seed: number;
  readonly claim: ClaimId;
  readonly galaxy: GalaxyId;
}

/** The `?galaxy=` the gameplay specs play: the first galaxy, in Free play. */
export const E2E_GALAXY: GalaxyId = '1-1';

/** The boss galaxy the boss specs play. */
export const BOSS_GALAXY: GalaxyId = '1-6';

/** The `?galaxy=` the game-over specs play with `?lives=1`, which makes it a one-life Rank run: a late galaxy, whose busier field ends an idle run within a few seconds, where 1-1 takes ten or more. */
export const GAME_OVER_GALAXY: GalaxyId = '5-5';

/** The `?galaxy=` the perf spec plays: the busiest field early on, 15 to 20 rocks by 15 s with the ship firing. */
export const PERF_GALAXY: GalaxyId = '5-5';

const ENTRIES = [
  // The default `?seed=`: its first 2.5 s in 1-1 keep rocks out of the lanes the fire assertions shoot through.
  { seed: 3, claim: 'lanes-clear', galaxy: E2E_GALAXY },
  // The boss specs: the idle ship lives through the 1-6 approach and intro to the boss fight, on both e2e fields.
  { seed: 3, claim: 'boss-fight', galaxy: BOSS_GALAXY },
  // The clock seed whose idle ship clears 1-1 on the desktop field, hit twice on the way (runController.test.ts plays it too).
  { seed: 2, claim: 'clears-1-1', galaxy: E2E_GALAXY },
  // The game-over specs, with `?lives=1`: an idle ship is hit a few seconds after its 3 s of invulnerability.
  { seed: 27, claim: 'one-life-death', galaxy: GAME_OVER_GALAXY },
  // The Rank specs: the same idle ship loses a continued run, and lives one at a time.
  { seed: 27, claim: 'three-deaths', galaxy: GAME_OVER_GALAXY },
  // The Free play game-over spec: three lives gone about 17 s in.
  { seed: 30, claim: 'free-game-over', galaxy: GAME_OVER_GALAXY },
  // The perf spec measures frame time, not an outcome; this seed pins a busy field so every run spawns the same rocks.
  { seed: 7, claim: 'busy-field', galaxy: PERF_GALAXY },
] as const satisfies readonly { readonly seed: number; readonly claim: string; readonly galaxy: GalaxyId }[];

/** A claim a seed in the table makes. */
export type ClaimId = (typeof ENTRIES)[number]['claim'];

/**
 * Every World seed an e2e spec depends on, in one table. Each entry is a claim about what the seed's idle ship does in
 * `galaxy`; tests/helpers/seedClaims.ts holds the check for it and tests/unit/e2eSeeds.test.ts runs every one headlessly.
 * Specs take their seeds from here (`seedFor`), never as literals.
 *
 * When content or balance changes break a claim, the guard fails and prints `run: npm run find-seeds -- <claim>`; set
 * the seed here to the lowest one it lists. Add a claim for any new seed a spec relies on.
 */
export const E2E_SEEDS: readonly SeedEntry[] = ENTRIES;

/** The table's entry for `claim`. */
export function entryFor(claim: ClaimId): SeedEntry {
  const entry = E2E_SEEDS.find((candidate) => candidate.claim === claim);
  if (entry === undefined) throw new RangeError(`No seed for claim "${claim}" in e2e/seeds.ts; add an entry and a check in tests/helpers/seedClaims.ts`);
  return entry;
}

/** The seed the table holds for `claim`. */
export function seedFor(claim: ClaimId): number {
  return entryFor(claim).seed;
}

/** Sim seconds into a boss galaxy by which its boss is fighting: the approach, the intro, and half a second. */
export const TO_BOSS_FIGHT_SECONDS = BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + 0.5;

/** Sim seconds within which the 'three-deaths' idle ship loses three lives on the desktop field. */
export const THREE_DEATHS_SECONDS = 120;

/** Sim seconds within which the 'free-game-over' idle ship loses its three lives on the desktop field. */
export const FREE_GAME_OVER_SECONDS = 40;

/** Seconds of sim time that clear 1-1: its timer runs out and the warp starts. */
export const CLEAR_1_1_SECONDS = 95;
