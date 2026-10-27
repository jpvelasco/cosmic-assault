import type { BossPart, BossView, Point } from '../../sim/boss/behaviour';
import type { SimEvent } from '../../sim/events';
import type { FieldPen } from '../fieldPen';
import type { Palette } from '../palette';
import type { Sprite, SpriteBaker } from '../sprites';

/** What the boss is drawn with this frame: the quality's glow strength, reduced motion, and where the ship is. */
export interface BossLook {
  readonly glow: number;
  /** Holds pulses, tumbles and rings steady, for reduced motion. */
  readonly still: boolean;
  readonly aimX: number;
  readonly aimY: number;
}

/** Where and how the boss pass draws a boss's body this frame; one object, refilled in place. */
export interface BossFrame {
  /** The core's interpolated centre. */
  x: number;
  y: number;
  /** The core's drawn scale: growing in through the intro, swelling as it dies. */
  size: number;
  /** How visible it is, 0 to 1. */
  shown: number;
  /** How far between the previous and the latest step, for interpolating parts. */
  alpha: number;
  /** Whether the core shows its white silhouette, in the first moments of a hit's flash. */
  tinted: boolean;
  look: BossLook;
}

/** What a drawer paints with. */
export interface DrawerKit {
  readonly ctx: CanvasRenderingContext2D;
  readonly pen: FieldPen;
  readonly baker: SpriteBaker;
  readonly palette: Palette;
}

/**
 * One boss's look. The boss pass draws what every boss shares (the glow, windup rings, shockwave and hit flash) and asks
 * the drawer for the rest. A drawer bakes its sprites by key and allocates nothing per frame.
 */
export interface BossDrawer {
  /** The soft glow under the boss. */
  readonly glow: string;
  /** More light under the body, drawn additively after the glow (the Monolith's haze once bare). */
  underglow?(boss: Readonly<BossView>, frame: Readonly<BossFrame>): void;
  /** The body, source-over at alpha `frame.shown`; it may change the alpha and composite, and restores source-over. */
  body(boss: Readonly<BossView>, frame: Readonly<BossFrame>): void;
  /** Advances its own clocks by `dt` seconds of real time. */
  advance?(dt: number, boss: Readonly<BossView>): void;
  handle?(event: SimEvent): void;
  /** Forgets the last fight. */
  reset?(): void;
}

export type DrawerFactory = (kit: DrawerKit) => BossDrawer;

/** A radial gradient lit from (x, y) out to radius `r1` around the origin. */
export function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, r0, 0, 0, r1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

/** A core's sprite baked under `key`, or its white silhouette while `tinted`. */
export function coreSprite({ baker }: DrawerKit, key: string, half: number, paint: (c: CanvasRenderingContext2D) => void, tinted: boolean): Sprite {
  const core = baker.custom(key, half, paint);
  return tinted ? (baker.white(key) ?? core) : core;
}

/** Blits `coreSprite` at the pen's place. */
export function blitCore(kit: DrawerKit, key: string, half: number, paint: (c: CanvasRenderingContext2D) => void, tinted: boolean): void {
  kit.pen.blit(coreSprite(kit, key, half, paint, tinted));
}

/** Writes into `out`, and returns, where `part` sits from the core's interpolated centre (cx, cy), `frame.alpha` of the way from its previous pose. */
export function partOffset(part: Readonly<BossPart>, frame: Readonly<BossFrame>, cx: number, cy: number, out: Point): Readonly<Point> {
  out.x = part.px + (part.x - part.px) * frame.alpha - cx;
  out.y = part.py + (part.y - part.py) * frame.alpha - cy;
  return out;
}

/** Room around a core's rim for its stroke. */
export const RIM_PAD = 2;
