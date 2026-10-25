/**
 * The `?seed=` every e2e spec loads. Its practice-level-1 asteroids stay out of the
 * lanes the fire assertions shoot through (the centre column on desktop, the centre
 * row on the phone) for the first 2.5 s of a run, so no hit removes a counted shot.
 *
 * Chosen as the lowest seed in 0-299 that clears every lane (tests/helpers/e2eLanes.ts);
 * tests/unit/e2eSeed.test.ts guards it. If that test fails because spawning or RNG
 * consumption changed, re-pick: from game/, run
 * `E2E_SEED_SCAN=0-300 npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose`, set E2E_SEED to
 * the lowest seed it prints, then rerun the test without the variable.
 */
export const E2E_SEED = 3;
