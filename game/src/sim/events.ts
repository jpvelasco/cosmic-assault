import type { BlastKind, TimedPickupId } from '../content/pickups';
import type { AttackId, BossId, FoeKind, ForceKind, GalaxyId, PickupId } from '../content/types';
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
  /** A shot struck the shielded core at (x, y): spent, harmlessly. */
  | { type: 'bossDeflected'; x: number; y: number }
  /** A shot hurt part `part` of a boss, at (x, y), leaving it `hp`. The blow that breaks it is `bossPartBroken` instead. */
  | { type: 'bossPartHit'; part: number; x: number; y: number; hp: number }
  /** A shot broke part `part` of a boss, at (x, y). */
  | { type: 'bossPartBroken'; part: number; x: number; y: number }
  /** A boss's core at (x, y) can be hurt again: its shield is down. */
  | { type: 'bossExposed'; x: number; y: number }
  /** A boss's core at (x, y) is shielded again: shots on it are deflected. */
  | { type: 'bossShielded'; x: number; y: number }
  /** The Hive Carrier at (x, y) has opened its hangar: shots through it hurt the carrier. */
  | { type: 'hangarOpen'; x: number; y: number }
  /** The Hive Carrier at (x, y) has closed its hangar: its whole hull deflects shots again. */
  | { type: 'hangarClose'; x: number; y: number }
  /** A boss fell to two thirds (2) or one third (3) of its HP. */
  | { type: 'bossPhase'; phase: 2 | 3 }
  /** A boss was beaten, its HP at 0: the galaxy warps out on the same step, and the boss dies over the warp. */
  | { type: 'bossDown'; id: BossId }
  /** A kill dropped pickup `id` of `kind` at (x, y). Whether it is the player's first of that kind is the app's to tell. */
  | { type: 'pickupDropped'; id: number; kind: PickupId; x: number; y: number }
  /** The ship touched a pickup and took it. */
  | { type: 'pickupCollected'; id: number; kind: PickupId }
  /** A pickup was not collected in time and is gone. */
  | { type: 'pickupExpired'; id: number }
  /** A timed effect ran out, or died with the ship. The Shield breaking is `shieldBroken` instead. */
  | { type: 'effectEnded'; kind: TimedPickupId }
  /** The Shield took a hit for the ship: no life lost, and the ship is invulnerable for a moment. */
  | { type: 'shieldBroken' }
  /** A Field Bomb or a Nova went off at (x, y), reaching `radius`: its kills and boss hits follow as their own events. */
  | { type: 'blast'; kind: BlastKind; x: number; y: number; radius: number }
  /** A foe has entered, at (x, y). */
  | { type: 'foeSpawned'; id: number; kind: FoeKind; x: number; y: number }
  /** A shot hurt a foe at (x, y) and left it alive with `hp`. The killing blow is `foeDestroyed` instead. */
  | { type: 'foeHit'; id: number; x: number; y: number; hp: number }
  /** A foe is gone at (x, y): killed for `points`, or, for 0, rammed by the ship or cleared by the warp. */
  | { type: 'foeDestroyed'; id: number; kind: FoeKind; x: number; y: number; points: number }
  /** Force field `id` of `kind` (a gravity well or a repulsion field) will start at `at` seconds into the galaxy, drawn at (x, y) from now. */
  | { type: 'wellWarning'; id: number; kind: ForceKind; x: number; y: number; at: number }
  | { type: 'wellStart'; id: number; kind: ForceKind }
  | { type: 'wellEnd'; id: number; kind: ForceKind };

/** A rock the warp cleared: destroyed for 0 points, which no kill scores. Its feedback is the warp's, not a kill's. */
export function isWarpClear(event: SimEvent): boolean {
  return event.type === 'asteroidDestroyed' && event.points === 0;
}
