import { galaxyById } from '../src/content/galaxies';
import { HAZARD_RULES } from '../src/content/hazards';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../src/content/pacingRules';
import type { GalaxyId, HazardType } from '../src/content/types';

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

/** The `?galaxy=` the perf spec plays: a busy field early on, among Void Rift's foes and hazards, with the ship firing. */
export const PERF_GALAXY: GalaxyId = '4-5';

/** The `?galaxy=` the Ion Reach spec plays: it has a gravity well from 46 s and the first Dimension with drones. */
export const ION_REACH_GALAXY: GalaxyId = '2-4';

/** The Crimson Nebula galaxy the hazard spec plays: mines among its foes, and a danger zone from 20 s. */
export const CRIMSON_GALAXY: GalaxyId = '3-4';

/** The galaxy the gunship spec plays: the first with gunships among every other foe from its start. */
export const GUNSHIP_GALAXY: GalaxyId = '5-1';

/** The Void Rift galaxy the hazard spec plays: a warp rift from 20 s. */
export const VOID_RIFT_GALAXY: GalaxyId = '4-4';

/** The Singularity galaxy the hazard spec plays: a black hole from 12 s at the field's centre, where the ship starts. */
export const SINGULARITY_GALAXY: GalaxyId = '5-2';

/** The boss galaxies of the last three Dimensions. */
export const WARDEN_GALAXY: GalaxyId = '3-6';
export const LEVIATHAN_GALAXY: GalaxyId = '4-6';
export const ECLIPSE_GALAXY: GalaxyId = '5-6';

/** The galaxy whose field the sprite-cache spec plays, the last survival galaxy, with every foe and its black hole. */
export const CACHE_GALAXY: GalaxyId = '5-5';

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
  { seed: 234, claim: 'busy-field', galaxy: PERF_GALAXY },
  // The perf spec's boss scene: skipped to the Hive Carrier's fight, a ship firing and turning keeps it fighting.
  { seed: 2, claim: 'carrier-fight', galaxy: CARRIER_GALAXY },
  // The Crimson Nebula spec: the idle ship is in play at the zone's warning, on into the zone, and on until it sees the first
  // mine to arm be the first to blast, on both e2e fields. Mines seldom drift close enough to a still ship to arm: about one
  // seed in 300.
  { seed: 176, claim: 'crimson-hazards', galaxy: CRIMSON_GALAXY },
  // The gunship spec: the idle ship sees a gunship wind up and fire, and a bolt leave across the field's edge, on both e2e
  // fields. Crimson Nebula's own galaxies bring gunships too seldom early on for a still ship to see that on both fields
  // in 300 seeds; Singularity mixes them in from its first galaxy.
  { seed: 2, claim: 'gunship-bolt', galaxy: GUNSHIP_GALAXY },
  // The Void Rift spec: the idle ship lives to the rift's warning and on while it is open.
  { seed: 1, claim: 'void-rift', galaxy: VOID_RIFT_GALAXY },
  // The Singularity spec: the idle ship lives to the hole's warning, and its first death comes back at the moved respawn.
  { seed: 1, claim: 'singularity-hole', galaxy: SINGULARITY_GALAXY },
  // The boss specs of the last three Dimensions: the idle ship lives through the approach and intro to the fight.
  { seed: 1, claim: 'warden-fight', galaxy: WARDEN_GALAXY },
  { seed: 1, claim: 'leviathan-fight', galaxy: LEVIATHAN_GALAXY },
  // A Rank run's last galaxy, which a clear ends on Rank complete.
  { seed: 1, claim: 'eclipse-rank', galaxy: ECLIPSE_GALAXY },
  // The sprite-cache spec: a ship firing and turning with five lives stays in play through the hold.
  { seed: 1, claim: 'cache-field', galaxy: CACHE_GALAXY },
  // The sprite-cache spec's boss fights: skipped to the fight, a ship firing and turning keeps it fighting.
  { seed: 4, claim: 'warden-cache', galaxy: WARDEN_GALAXY },
  { seed: 1, claim: 'leviathan-cache', galaxy: LEVIATHAN_GALAXY },
  { seed: 2, claim: 'eclipse-cache', galaxy: ECLIPSE_GALAXY },
] as const satisfies readonly { readonly seed: number; readonly claim: string; readonly galaxy: GalaxyId }[];

/** A claim a seed in the table makes. */
export type ClaimId = (typeof ENTRIES)[number]['claim'];

/**
 * Every World seed an e2e spec depends on, in one table. Each entry is a claim about what the seed's idle ship does in
 * `galaxy`; tests/helpers/seedClaims.ts holds the check for it and tests/unit/e2eSeeds.test.ts runs every one headlessly.
 * Specs take their seeds from here (`seedFor`), never as literals.
 *
 * When content or balance changes break a claim, the guard fails and prints `run: npm run find-seeds -- <claim>`; set
 * the seed here to the lowest one it lists. A seed that still keeps its claim stays, even where a lower one would keep
 * it too, so the specs it drives do not change under them (and specs that share one seed across claims keep sharing
 * it). Add a claim for any new seed a spec relies on, with the lowest seed `find-seeds` lists for it.
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

/** One date and the claim its Daily Galaxy, on that date's own World seed, makes about an idle ship. */
export interface DateEntry {
  readonly date: string;
  readonly claim: DateClaimId;
}

/** The first date `find-seeds` tries for a date claim; it counts `--from` and `--to` in days from here. */
export const DATE_EPOCH = '2026-01-01';

const DATE_ENTRIES = [
  // The Daily spec's clear: the idle ship lives to the warp on the desktop and phone fields, and the clear writes the Daily record.
  { date: '2026-01-04', claim: 'daily-clears' },
  // The Daily spec's streak: the idle ship clears this date and the next on the desktop field, so two clears run a streak of 2.
  { date: '2027-10-06', claim: 'daily-streak' },
  // The Daily spec's game over: the idle ship loses its three lives within DAILY_GAME_OVER_SECONDS.
  { date: '2026-01-01', claim: 'daily-game-over' },
] as const satisfies readonly { readonly date: string; readonly claim: string }[];

/** A claim a date in the table makes. */
export type DateClaimId = (typeof DATE_ENTRIES)[number]['claim'];

/**
 * Every date an e2e spec plays a Daily of with `?today=`, in one table, as for the seeds: a Daily's World seed comes from
 * its date, so the date is what a spec picks. tests/helpers/seedClaims.ts holds each claim's check, and a broken one
 * prints `run: npm run find-seeds -- <claim>`, which lists the earliest dates from DATE_EPOCH that keep it.
 */
export const E2E_DATES: readonly DateEntry[] = DATE_ENTRIES;

/** The date the table holds for `claim`. */
export function dateFor(claim: DateClaimId): string {
  const entry = E2E_DATES.find((candidate) => candidate.claim === claim);
  if (entry === undefined) throw new RangeError(`No date for claim "${claim}" in e2e/seeds.ts; add an entry and a check in tests/helpers/seedClaims.ts`);
  return entry.date;
}

/** Sim seconds within which the 'daily-game-over' idle ship loses its three lives on the desktop field. */
export const DAILY_GAME_OVER_SECONDS = 60;

/** Sim seconds that outlast any Daily: its galaxy's length and the warp, with room to spare. */
export const DAILY_CLEAR_SECONDS = 150;

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

/** Sim seconds into `galaxy` half a second after its first `type` hazard starts its warning. */
export function warnedSeconds(galaxy: GalaxyId, type: HazardType): number {
  const event = galaxyById(galaxy).events.find((e) => e.type === type);
  if (event === undefined) throw new RangeError(`${galaxy} schedules no ${type}; pick a galaxy that does`);
  return event.at - HAZARD_RULES[type].telegraph + 0.5;
}

/** Sim seconds by which the 'crimson-hazards' idle ship has seen a mine arm and blast. */
export const CRIMSON_WATCH_SECONDS = 60;

/** Sim seconds by which the 'gunship-bolt' idle ship has seen a gunship fire and a bolt leave across the edge. */
export const GUNSHIP_WATCH_SECONDS = 90;

/** The `?lives=` the foe and hazard specs play with: an idle ship is hit now and then, and a mine arms only near a ship that can be hit. */
export const WATCH_LIVES = 5;

/** Sim seconds within which the 'singularity-hole' idle ship loses its first life to the hole. */
export const HOLE_DEATH_SECONDS = 20;

/** Seconds the sprite-cache spec plays each scene, holding fire and a left turn. */
export const CACHE_HOLD_SECONDS = 20;

/** The `?lives=` the sprite-cache spec plays with, the most a run allows, so its ship outlasts the hold. */
export const CACHE_LIVES = 5;
