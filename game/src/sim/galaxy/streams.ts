import type { HazardType } from '../../content/types';
import { hazardStreams } from '../hazards/hazardField';
import { createRng, deriveSeed, type Rng } from '../rng';

/** The named streams a galaxy run draws from, one per concern, so one never shifts another. */
export interface GalaxyStreams {
  /** Kinds, spawn points and showers. */
  readonly director: Rng;
  readonly boss: Rng;
  /** Whether a kill drops, and what. */
  readonly pickups: Rng;
  /** Foe behaviour: where they enter, their headings and their fragments. */
  readonly foes: Rng;
  /** Each hazard type's own stream (`hazardStreamName`): where it sits, and what else it rolls. The same stream on every call. */
  readonly hazards: (type: HazardType) => Rng;
}

/** The streams of a run with `seed`. */
export function galaxyStreams(seed: number): GalaxyStreams {
  const stream = (name: string): Rng => createRng(deriveSeed(seed, name));
  return { director: stream('director'), boss: stream('boss'), pickups: stream('pickups'), foes: stream('foes'), hazards: hazardStreams(seed) };
}
