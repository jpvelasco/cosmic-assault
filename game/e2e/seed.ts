/**
 * The `?seed=` every e2e spec loads. Its practice-level-1 asteroids stay out of the
 * lanes the fire assertions shoot through (the centre column on desktop, the centre
 * row on the phone) for the first 2.5 s of a run, so no hit removes a counted shot.
 *
 * Chosen as the lowest seed in 0-299 that clears every lane (tests/helpers/e2eLanes.ts);
 * tests/unit/e2eSeed.test.ts guards it. If that test fails because spawning or RNG
 * consumption changed, re-pick: from game/, run
 * `E2E_SEED_SCAN=0-300 npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose`
 * (PowerShell: `$env:E2E_SEED_SCAN='0-300'; npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose`),
 * set E2E_SEED to the lowest lane-clear seed it prints, then rerun the test without the variable.
 */
export const E2E_SEED = 3;

/**
 * The `?seed=` the game-over specs load with `?lives=1`: an idle ship at the centre is hit
 * soon after its 3 s of invulnerability on both e2e fields (3.1 s on desktop, 3.5 s on the phone).
 * Chosen as the lowest such seed in 0-299; tests/unit/e2eSeed.test.ts guards it and its scan
 * prints replacements.
 */
export const GAME_OVER_SEED = 1;

/**
 * The `?seed=` the perf spec loads. Any seed works, as it measures frame time rather than a
 * scripted outcome; this one is fixed so every run spawns the same rocks.
 */
export const PERF_SEED = 7;
