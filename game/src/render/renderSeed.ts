/**
 * Render-only randomness; the sim never reads it. Each consumer derives its own stream, so the
 * sky dust, stars, flame flicker and bursts never line up with one another.
 */
export const RENDER_SEED = 0x57a7f1e1;
