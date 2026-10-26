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
  /**
   * The galaxy is won, on the step the warp starts (the timer runs out, or a boss's HP hits 0): the outcome is final
   * then. The status turns `'cleared'` 1.5 s later, or once a beaten boss has died, 2 s later.
   */
  | { type: 'galaxyCleared'; score: number; deaths: number; stars: Stars; bonus: number }
  /** The combo multiplier changed. */
  | { type: 'combo'; multiplier: number }
  /** A boss has arrived and cannot be hurt for its intro. */
  | { type: 'bossIntro'; id: BossId }
  /** A boss is telegraphing `attack` from (x, y); it does no harm until the windup ends. */
  | { type: 'bossWindup'; attack: AttackId; x: number; y: number }
  /** A shot hurt a boss: it struck at (x, y) and left the boss with `hp`. Shots into an invulnerable boss make none. */
  | { type: 'bossHit'; x: number; y: number; hp: number }
  /** A boss fell to two thirds (2) or one third (3) of its HP. */
  | { type: 'bossPhase'; phase: 2 | 3 }
  /** A boss was beaten, its HP at 0: the galaxy warps out on the same step, and the boss dies over the warp. */
  | { type: 'bossDown'; id: BossId };

/** A rock the warp cleared: destroyed for 0 points, which no kill scores. Its feedback is the warp's, not a kill's. */
export function isWarpClear(event: SimEvent): boolean {
  return event.type === 'asteroidDestroyed' && event.points === 0;
}
