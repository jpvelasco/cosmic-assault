/**
 * The `?seed=` every e2e spec loads. Its practice-level-1 asteroids stay out of the
 * lanes the fire assertions shoot through (the centre column on desktop, the centre
 * row on the phone) for the first 2.5 s of a run, so no hit removes a counted shot.
 *
 * Chosen by running `lanesStayClear` from tests/unit/e2eSeed.test.ts over seeds 0–299
 * and taking the lowest seed that clears every lane; that test guards it. If the guard
 * fails because spawning or RNG consumption changed, re-pick the same way: loop
 * `lanesStayClear` over candidate seeds in a scratch test and set the first that passes.
 */
export const E2E_SEED = 3;
