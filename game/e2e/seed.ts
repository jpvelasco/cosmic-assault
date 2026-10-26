import type { GalaxyId } from '../src/content/types';

/** The `?galaxy=` the gameplay specs play: the first galaxy, in Free play. */
export const E2E_GALAXY: GalaxyId = '1-1';

/**
 * The `?galaxy=` the game-over specs play with `?lives=1`, which makes it a one-life Rank run: a late galaxy,
 * whose busier field ends an idle run within a few seconds, where 1-1 takes ten or more.
 */
export const GAME_OVER_GALAXY: GalaxyId = '5-5';

/**
 * The `?seed=` every e2e spec loads. Its E2E_GALAXY asteroids stay out of the
 * lanes the fire assertions shoot through (the centre column on desktop, the centre
 * row on the phone) for the first 2.5 s of a run, so no hit removes a counted shot.
 *
 * Kept from the practice runs, where it was the lowest seed in 0-299 that cleared every lane (tests/helpers/e2eLanes.ts);
 * a galaxy opens on an empty field, so in E2E_GALAXY every such seed does. tests/unit/e2eSeed.test.ts guards it. If that test fails because spawning or RNG
 * consumption changed, re-pick: from game/, run
 * `E2E_SEED_SCAN=0-300 npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose`
 * (PowerShell: `$env:E2E_SEED_SCAN='0-300'; npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose`),
 * set E2E_SEED to the lowest lane-clear seed it prints, then rerun the test without the variable.
 */
export const E2E_SEED = 3;

/**
 * The `?seed=` the game-over specs load with GAME_OVER_GALAXY and `?lives=1`: an idle ship at the centre is hit
 * a few seconds after its 3 s of invulnerability on both e2e fields (6.3 s on desktop, 7.1 s on the phone).
 * Chosen as the lowest such seed in 0-299; tests/unit/e2eSeed.test.ts guards it and its scan
 * prints replacements.
 */
export const GAME_OVER_SEED = 27;

/**
 * The `?seed=` the perf spec loads. Any seed works, as it measures frame time rather than a
 * scripted outcome; this one is fixed so every run spawns the same rocks.
 */
export const PERF_SEED = 7;

/** The `?galaxy=` the perf spec plays: the busiest field early on, 15 to 20 rocks by 15 s with the ship firing. */
export const PERF_GALAXY: GalaxyId = '5-5';
