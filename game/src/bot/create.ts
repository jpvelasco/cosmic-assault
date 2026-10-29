import { createRng, deriveSeed, type Rng } from '../sim/rng';
import { createCasual } from './casual';
import { createExpert } from './expert';
import { STATUE } from './statue';
import type { Bot } from './view';

export type BotProfile = 'statue' | 'casual' | 'expert';

/** The stream a bot of a run with `seed` draws from, that seed's 'bot' stream alone, so a bot never shifts a sim stream. */
export const botRng = (seed: number): Rng => createRng(deriveSeed(seed, 'bot'));

/** A bot of `profile` for a run with `seed`, drawing only from `botRng(seed)`. */
export function createBot(profile: BotProfile, seed: number): Bot {
  if (profile === 'statue') return STATUE;
  const rng = botRng(seed);
  return profile === 'expert' ? createExpert(rng) : createCasual(rng);
}
