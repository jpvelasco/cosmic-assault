import type { FoeKind } from '../content/types';
import { isWarpClear, type SimEvent } from '../sim/events';
import { smoothstep } from '../sim/math';
import type { SpriteBaker } from './sprites';

/** How long a hit object shows white. */
export const HIT_FLASH_SECONDS = 0.06;
/** How long the ship's squash lasts, from `SQUASH_SCALE` at the impact back to full size. */
export const SQUASH_SECONDS = 0.08;
/** The ship's scale at the moment of impact. */
export const SQUASH_SCALE = 0.9;
/** The most rock flashes, and the most foe flashes, at once. A busy field breaks a few rocks a frame, each flash lasting a few frames. */
const MAX_FLASHES = 24;

/** A destroyed rock's white silhouette, held where it broke. */
export interface RockFlash {
  /** The silhouette's cache key, not the sprite: a rebake can free the sprite mid-flash, so the renderer looks it up each frame. */
  readonly key: string;
  readonly x: number;
  readonly y: number;
  /** Seconds of the flash still to show, from `HIT_FLASH_SECONDS` down; the renderer fades by `left / HIT_FLASH_SECONDS`. */
  left: number;
}

/** A hurt or destroyed foe's white silhouette, held where it was hit. */
export interface FoeFlash {
  /** Which foe's silhouette to show; the renderer looks its sprite up by this each frame, as a rebake can free it. */
  readonly kind: FoeKind;
  readonly x: number;
  readonly y: number;
  /** Seconds of the flash still to show, from `HIT_FLASH_SECONDS` down. */
  left: number;
}

export interface HitFlash {
  /** A rock breaking or a foe being hit flashes its white silhouette; the ship being hit squashes it. */
  handle(events: readonly SimEvent[]): void;
  /** Advances every flash and the squash by `dt` seconds of real time (hit-stop included). */
  step(dt: number): void;
  /** The rock silhouettes showing now. Allocated per rock broken, not per frame. */
  readonly rocks: readonly Readonly<RockFlash>[];
  /** The foe silhouettes showing now. */
  readonly foes: readonly Readonly<FoeFlash>[];
  /** The ship's scale this frame: 1 at rest. Reduced motion is the caller's to apply, since the white flash stays under it. */
  readonly shipScale: number;
  /** Drops every flash and the squash, for a new run. */
  reset(): void;
}

/** Counts every flash in `flashes` down by `dt` seconds and drops those that have run out. */
function age(flashes: { left: number }[], dt: number): void {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const flash = flashes[i] as { left: number };
    flash.left -= dt;
    if (flash.left <= 0) flashes.splice(i, 1);
  }
}

/**
 * The hit-object juice (CA-027): a white flash on whatever was hit, and a squash on the ship when it is.
 *
 * A destroyed rock is gone from the world by the time the renderer hears of it, so the flash is the rock's own white
 * silhouette held at the spot it broke, not its fragments: every size gives one (the tiny rocks split into none),
 * and the event carries the position and id, which is all it needs. The silhouette is not turned: events carry no
 * rotation, and adding one would change the sim's events, whose outputs the parity and practice traces pin.
 * A foe flashes the same way, on a hit and on its destruction. `foeHit` does not say which kind was hit, so it is
 * remembered from the foe's `foeSpawned`.
 */
export function createHitFlash(baker: Pick<SpriteBaker, 'whiteRock'>): HitFlash {
  const rocks: RockFlash[] = [];
  const foes: FoeFlash[] = [];
  const kinds = new Map<number, FoeKind>();
  let squashAge = Number.POSITIVE_INFINITY;

  function flashFoe(kind: FoeKind | undefined, at: { readonly x: number; readonly y: number }): void {
    if (kind !== undefined && foes.length < MAX_FLASHES) foes.push({ kind, x: at.x, y: at.y, left: HIT_FLASH_SECONDS });
  }

  return {
    handle(events) {
      for (const event of events) {
        if (event.type === 'shipHit') {
          squashAge = 0;
        } else if (event.type === 'asteroidDestroyed' && !isWarpClear(event) && rocks.length < MAX_FLASHES) {
          // Baked now: the renderer forgets the rock's sprites right after it hears of its end.
          const key = baker.whiteRock(event.id);
          if (key !== undefined) rocks.push({ key, x: event.x, y: event.y, left: HIT_FLASH_SECONDS });
        } else if (event.type === 'foeSpawned') {
          kinds.set(event.id, event.kind);
        } else if (event.type === 'foeHit') {
          flashFoe(kinds.get(event.id), event);
        } else if (event.type === 'foeDestroyed') {
          kinds.delete(event.id);
          // As with a rock, a foe the warp cleared or the ship rammed (0 points) is not flashed.
          if (event.points > 0) flashFoe(event.kind, event);
        }
      }
    },
    step(dt) {
      squashAge += dt;
      age(rocks, dt);
      age(foes, dt);
    },
    rocks,
    foes,
    get shipScale() {
      if (squashAge >= SQUASH_SECONDS) return 1;
      const t = squashAge / SQUASH_SECONDS;
      return SQUASH_SCALE + smoothstep(t, 1 - SQUASH_SCALE);
    },
    reset() {
      rocks.length = 0;
      foes.length = 0;
      kinds.clear();
      squashAge = Number.POSITIVE_INFINITY;
    },
  };
}
