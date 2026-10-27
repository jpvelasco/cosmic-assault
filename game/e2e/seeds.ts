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

/** The boss galaxy the Hive Carrier spec plays. */
export const CARRIER_GALAXY: GalaxyId = '2-6';

/** The `?galaxy=` the game-over specs play with `?lives=1`, which makes it a one-life Rank run: a late galaxy, whose busier field ends an idle run within a few seconds, where 1-1 takes ten or more. */
export const GAME_OVER_GALAXY: GalaxyId = '5-5';

/** The `?galaxy=` the perf spec plays: the busiest field early on, 15 to 20 rocks by 15 s with the ship firing. */
export const PERF_GALAXY: GalaxyId = '5-5';

/** The `?galaxy=` the Ion Reach spec plays: it has a gravity well from 46 s and the first Dimension with drones. */
export const ION_REACH_GALAXY: GalaxyId = '2-4';

const ENTRIES = [
  // The default `?seed=`: its first 2.5 s in 1-1 keep rocks out of the lanes the fire assertions shoot through.
  { seed: 3, claim: 'lanes-clear', galaxy: E2E_GALAXY },
  // The boss specs: the idle ship lives through the 1-6 approach and intro to the boss fight, on both e2e fields.
  { seed: 3, claim: 'boss-fight', galaxy: BOSS_GALAXY },
  // The Hive Carrier spec: the idle ship that fires at the shut hangar has a shot turned away, then lives to see the hangar open.
  { seed: 1, claim: 'hangar-opens', galaxy: CARRIER_GALAXY },
  // The clock seed whose idle ship clears 1-1 on the desktop field, hit twice on the way (runController.test.ts plays it too).
  { seed: 2, claim: 'clears-1-1', galaxy: E2E_GALAXY },
  // The game-over specs, with `?lives=1`: an idle ship is hit a few seconds after its 3 s of invulnerability.
  { seed: 27, claim: 'one-life-death', galaxy: GAME_OVER_GALAXY },
  // The Rank specs: the same idle ship loses a continued run, and lives one at a time.
  { seed: 27, claim: 'three-deaths', galaxy: GAME_OVER_GALAXY },
  // The Free play game-over spec: three lives gone about 17 s in.
  { seed: 30, claim: 'free-game-over', galaxy: GAME_OVER_GALAXY },
  // The Ion Reach spec: the idle ship lives to the well's warning, with a foe on the field, and on into the pull.
  { seed: 12, claim: 'ion-reach-hazards', galaxy: ION_REACH_GALAXY },
  // The perf spec measures frame time, not an outcome; this seed pins a busy field so every run spawns the same rocks.
  { seed: 3, claim: 'busy-field', galaxy: PERF_GALAXY },
  // The perf spec's boss scene: skipped to the Hive Carrier's fight, a ship firing and turning keeps it fighting.
  { seed: 2, claim: 'carrier-fight', galaxy: CARRIER_GALAXY },
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

/** Seconds the perf spec measures the busy field, holding fire and a left turn. */
export const PERF_HOLD_SECONDS = 20;

/**
 * Seconds the perf spec plays a scene it skips into before measuring it: long enough for the quality level, which
 * starts each run at the top, to step down to what the scene needs, as it would have in the play skipped.
 */
export const PERF_SETTLE_SECONDS = 7;

/** Seconds the perf spec measures the boss fight: shorter than PERF_HOLD_SECONDS, as the fight takes lives fast. */
export const PERF_FIGHT_HOLD_SECONDS = 15;

/** The `?lives=` the perf spec's boss fight plays with, the most a run allows, so its ship outlasts the measure. */
export const PERF_FIGHT_LIVES = 5;

/** Sim seconds the Hive Carrier spec holds fire at the shut hangar: its first launch comes 3.2 s into the fight, so this leaves slack. */
export const HULL_FIRE_SECONDS = 1;

/** Sim seconds after the hull fire by which the Hive Carrier has launched and opened its hangar. */
export const HANGAR_OPENS_SECONDS = 4;

/** Sim seconds within which the 'three-deaths' idle ship loses three lives on the desktop field. */
export const THREE_DEATHS_SECONDS = 120;

/** Sim seconds within which the 'free-game-over' idle ship loses its three lives on the desktop field. */
export const FREE_GAME_OVER_SECONDS = 40;

/** Seconds of sim time that clear 1-1: its timer runs out and the warp starts. */
export const CLEAR_1_1_SECONDS = 95;

/** Sim seconds into `ION_REACH_GALAXY` by which its well is telegraphed: it starts at 46 s, with a 2 s warning from 44 s. */
export const WELL_WARNING_SECONDS = 44.5;

/** Sim seconds after `WELL_WARNING_SECONDS` by which that well is pulling (it starts at 46 s). */
export const WELL_PULL_SECONDS = 2;
