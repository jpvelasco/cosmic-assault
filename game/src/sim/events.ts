import type { AsteroidSize } from './asteroid';

/** Plain facts from one `World.step`, for the renderer and audio to react to. */
export type SimEvent =
  | { type: 'shot'; x: number; y: number }
  | { type: 'asteroidDestroyed'; x: number; y: number; size: AsteroidSize; points: number }
  | { type: 'shipHit'; x: number; y: number; livesLeft: number }
  | { type: 'gameOver'; score: number };
