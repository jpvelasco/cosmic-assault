import type { AttackId, BossId, GalaxyId } from '../content/types';
import type { AsteroidSize } from './asteroid';
import type { Stars } from './scoring';

/** Plain facts from one `World.step`, for the renderer and audio to react to. */
export type SimEvent =
  | { type: 'shot'; x: number; y: number }
  | { type: 'asteroidDestroyed'; id: number; x: number; y: number; size: AsteroidSize; points: number }
  /** A meteor passed out of the field and was removed: no score, no burst. */
  | { type: 'asteroidLeft'; id: number }
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
  | { type: 'combo'; multiplier: number }
  /** A boss has arrived and cannot be hurt for its intro. */
  | { type: 'bossIntro'; id: BossId }
  /** A boss is telegraphing `attack` from (x, y); it does no harm until the windup ends. */
  | { type: 'bossWindup'; attack: AttackId; x: number; y: number }
  /** A boss fell to two thirds (2) or one third (3) of its HP. */
  | { type: 'bossPhase'; phase: 2 | 3 }
  /** A boss finished dying; the galaxy warps out. */
  | { type: 'bossDown'; id: BossId };
