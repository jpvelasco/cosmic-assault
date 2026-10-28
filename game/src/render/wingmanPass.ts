import type { Field } from '../sim/field';
import { wingmanPoint } from '../sim/pickups/wingman';
import type { World } from '../sim/world';
import { BLACK, mix, rgba, WHITE } from './color';
import { expiryAlpha } from './pickupArt';
import { interpolatePose } from './interp';
import type { Palette } from './palette';
import type { SceneLook, Stamp } from './scene';
import { addStops, maxDistance, paintGlow, strokePath, tracePath, type Point, type SpriteBaker } from './sprites';

export interface WingmanPass {
  /** The Wingman drone, beside the ship's left wing where its shots start, while the effect runs (blinking as it ends). */
  draw(world: World, alpha: number, field: Field, look: SceneLook): void;
}

/** Room around the drone's art for its rim, in field units. */
const SPRITE_PAD = 3;
/** The drone's hull, nose along +x: a short wedge with swept wings, smaller than the ship. */
const HULL: readonly Point[] = [
  { x: 10, y: 0 },
  { x: -7, y: 7.5 },
  { x: -3, y: 0 },
  { x: -7, y: -7.5 },
];
/** The drone's glow, as a share of the ship's, drawn under it. */
const GLOW_DIAMETER = 40;
const GLOW_ALPHA = 0.3;

/** The Wingman's sprite: a small wedge in the ship's green, with a glowing canopy and a rim. It is friendly, so never a foe's colour. */
function paintWingman(ctx: CanvasRenderingContext2D, p: Palette): void {
  const hull = p.ship[1];
  ctx.lineJoin = 'round';
  tracePath(ctx, HULL);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, 8, 0, -8), [mix(hull, BLACK, 0.6), mix(hull, BLACK, 0.15), mix(hull, WHITE, 0.4)], [0, 0.5, 1]);
  ctx.fill();
  strokePath(ctx, rgba(WHITE, 0.7), 1);
  paintGlow(ctx, p.cockpit, 2.5, 0, 3.4, 1);
}

/**
 * Draws the Wingman: from baked sprites, under the ship's pose, `WINGMAN.offset` off its left wing (where its shot starts),
 * with a glow under it. It is drawn only while the effect runs, and blinks as the effect ends, as a pickup does.
 */
export function createWingmanPass(ctx: CanvasRenderingContext2D, stamp: Stamp, baker: SpriteBaker, palette: Palette): WingmanPass {
  const key = `wingman|${palette.id}`;
  const pose = { x: 0, y: 0, angle: 0 };
  const drone = { x: 0, y: 0 };
  const paint = (c: CanvasRenderingContext2D): void => {
    paintWingman(c, palette);
  };
  const halfSize = maxDistance(HULL) + SPRITE_PAD;

  return {
    draw(world, alpha, field, { glow, still }) {
      const left = world.effects.wingman;
      if (left <= 0 || world.status === 'gameOver') return;
      const { ship } = world;
      interpolatePose(ship.px, ship.py, ship.pangle, ship.x, ship.y, ship.angle, alpha, field, pose);
      // Where its shot starts, the same point `wingmanShot` uses.
      wingmanPoint(pose, drone);
      const { x, y } = drone;
      const visible = expiryAlpha(left, still);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = GLOW_ALPHA * glow * visible;
      stamp(baker.glow(palette.ship[1], GLOW_DIAMETER), x, y, 1, 0, GLOW_DIAMETER / 2, field);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = visible;
      const sprite = baker.custom(key, halfSize, paint);
      stamp(sprite, x, y, Math.cos(pose.angle), Math.sin(pose.angle), sprite.halfW, field);
      ctx.globalAlpha = 1;
    },
  };
}

