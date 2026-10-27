import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';

/** The seeds every clear-rate test plays. */
export const BOT_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** `profile` playing galaxy `id` once per seed in `BOT_SEEDS`. */
export function botRuns(id: GalaxyId, profile: BotProfile, maxSeconds?: number): RunResult[] {
  const galaxy = galaxyById(id);
  return BOT_SEEDS.map((seed) => runGalaxy({ galaxy, seed, profile, ...(maxSeconds === undefined ? {} : { maxSeconds }) }));
}

/** Ten whole galaxies take seconds, more on a loaded CI runner than Vitest's 5 s default. */
export const BOT_RUN_TIMEOUT_MS = 60_000;

export const clears = (results: readonly RunResult[]): number => results.filter((r) => r.cleared).length;
