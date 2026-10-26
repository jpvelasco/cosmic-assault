import { isWarpClear, type SimEvent } from '../sim/events';
import type { Sprite, SpriteBaker } from './sprites';

/** How long a hit object shows white. */
export const HIT_FLASH_SECONDS = 0.06;
/** How long the ship's squash lasts, from `SQUASH_SCALE` at the impact back to full size. */
export const SQUASH_SECONDS = 0.08;
/** The ship's scale at the moment of impact. */
export const SQUASH_SCALE = 0.9;
/** The most rock flashes at once. A busy field breaks a few rocks a frame, each flash lasting a few frames. */
const MAX_ROCK_FLASHES = 24;

/** A destroyed rock's white silhouette, held where it broke. */
export interface RockFlash {
  readonly sprite: Sprite;
  readonly x: number;
  readonly y: number;
  /** Seconds of the flash still to show, from `HIT_FLASH_SECONDS` down; the renderer fades by `left / HIT_FLASH_SECONDS`. */
  left: number;
}

export interface HitFlash {
  /** A rock breaking flashes its white silhouette; the ship being hit squashes it. */
  handle(events: readonly SimEvent[]): void;
  /** Advances every flash and the squash by `dt` seconds of real time (hit-stop included). */
  step(dt: number): void;
  /** The rock silhouettes showing now. Allocated per rock broken, not per frame. */
  readonly rocks: readonly Readonly<RockFlash>[];
  /** The ship's scale this frame: 1 at rest. Reduced motion is the caller's to apply, since the white flash stays under it. */
  readonly shipScale: number;
  /** Drops every flash and the squash, for a new run. */
  reset(): void;
}

/**
 * The hit-object juice (CA-027): a white flash on whatever was hit, and a squash on the ship when it is.
 *
 * A destroyed rock is gone from the world by the time the renderer hears of it, so the flash is the rock's own white
 * silhouette held at the spot it broke, not its fragments: every size gives one (the tiny rocks split into none),
 * and the event carries the position and id, which is all it needs. The silhouette is not turned: events carry no
 * rotation, and adding one would change the sim's events, whose outputs the parity and practice traces pin.
 */
export function createHitFlash(baker: Pick<SpriteBaker, 'whiteRock'>): HitFlash {
  const rocks: RockFlash[] = [];
  let squashAge = Number.POSITIVE_INFINITY;

  return {
    handle(events) {
      for (const event of events) {
        if (event.type === 'shipHit') {
          squashAge = 0;
        } else if (event.type === 'asteroidDestroyed' && !isWarpClear(event) && rocks.length < MAX_ROCK_FLASHES) {
          // Looked up now: the renderer forgets the rock's sprites right after it hears of its end.
          const sprite = baker.whiteRock(event.id);
          if (sprite !== undefined) rocks.push({ sprite, x: event.x, y: event.y, left: HIT_FLASH_SECONDS });
        }
      }
    },
    step(dt) {
      squashAge += dt;
      for (let i = rocks.length - 1; i >= 0; i--) {
        const rock = rocks[i] as RockFlash;
        rock.left -= dt;
        if (rock.left <= 0) rocks.splice(i, 1);
      }
    },
    rocks,
    get shipScale() {
      if (squashAge >= SQUASH_SECONDS) return 1;
      const t = squashAge / SQUASH_SECONDS;
      return SQUASH_SCALE + (1 - SQUASH_SCALE) * t * t * (3 - 2 * t);
    },
    reset() {
      rocks.length = 0;
      squashAge = Number.POSITIVE_INFINITY;
    },
  };
}
