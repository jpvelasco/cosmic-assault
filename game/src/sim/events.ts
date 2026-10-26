import type { GalaxyId } from '../content/types';
import type { AsteroidSize } from './asteroid';
import type { Stars } from './scoring';

/** Plain facts from one `World.step`, for the renderer and audio to react to. */
export type SimEvent =
  | { type: 'shot'; x: number; y: number }
  | { type: 'asteroidDestroyed'; id: number; x: number; y: number; size: AsteroidSize; points: number }
  | { type: 'shipHit'; x: number; y: number; livesLeft: number }
  | { type: 'gameOver'; score: number }
  | { type: 'galaxyStart'; id: GalaxyId }
  /** A meteor shower will start at `at` seconds into the galaxy, from the edge at bearing `angle`. */
  | { type: 'showerWarning'; angle: number; at: number }
  | { type: 'showerStart' }
  | { type: 'showerEnd' }
  | { type: 'warpOut' }
  | { type: 'galaxyCleared'; score: number; deaths: number; stars: Stars; bonus: number }
  /** The combo multiplier changed. */
  | { type: 'combo'; multiplier: number };
