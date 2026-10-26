import type { GalaxyDef } from './types';

/** Phase lengths in seconds. They live in content so galaxy definitions can place events by them without importing sim/. */
export const OPENING_SECONDS = 15;
export const LULL_SECONDS = 10;
export const SURGE_SECONDS = 20;
/** How long a boss galaxy's approach lasts before its boss arrives. */
export const BOSS_APPROACH_SECONDS = 20;
/** How long a boss's arrival lasts, unhurt and harmless, before it fights. */
export const BOSS_INTRO_SECONDS = 2;

/** When a survival galaxy's lull starts: it ends as the surge begins, 20 s before the duration. */
export const lullStart = (galaxy: Pick<GalaxyDef, 'duration'>): number => galaxy.duration - SURGE_SECONDS - LULL_SECONDS;
