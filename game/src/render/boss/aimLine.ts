import type { BossView } from '../../sim/boss/behaviour';
import { TAU } from '../../sim/math';
import { mix, rgba, WHITE } from '../color';
import { marchDash, solidLines, strokePath } from '../sprites';
import type { BossFrame, DrawerKit } from './drawer';
import { paintReticle } from './reticle';

/** A dive's aim line, as the boss pass draws it. */
export interface AimLine {
  /** Draws the line for `boss` winding up a dive `clock` seconds of its own time in; nothing outside a dive's windup. */
  draw(boss: Readonly<BossView>, frame: Readonly<BossFrame>, clock: number): void;
}

/** The dashes of the line, in field units, and how fast they march toward the aim unless held still. */
const DASH = [14, 10];
const DASH_SPEED = 120;
const LINE_WIDTH = 3;
/** The reticle at the aim: its radius, and how it closes in as the windup runs. */
const RETICLE_RADIUS = 26;
const RETICLE_CLOSE = 0.6;
const RETICLE_CLOSE_SECONDS = 0.7;

/** The reticle at radius `r`: a broken ring with four ticks pointing in, round a thin whole ring. */
function paintAimReticle(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  paintReticle(ctx, { arc: r * 0.8, tickFrom: r, tickTo: r * 0.55, passes: [[rgba(color, 0.9), 3]] });
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 0, TAU);
  strokePath(ctx, rgba(mix(color, WHITE, 0.6), 0.9), 1.2);
}

/**
 * The aim line a dive shows through its windup, in the Dimension's hostile hue: a dashed line from the core to the
 * windup's aim (`BossView.aim`), marching toward it, and a reticle there closing in as the dive nears. Strokes no path
 * and bakes nothing outside a dive's windup, and allocates nothing as it draws.
 */
export function createAimLine({ ctx, pen, baker, palette }: DrawerKit): AimLine {
  const color = palette.accent[0];
  const stroke = rgba(color, 0.85);
  const key = `boss|${palette.id}|aim|reticle`;
  const paint = (c: CanvasRenderingContext2D): void => {
    paintAimReticle(c, RETICLE_RADIUS, color);
  };
  return {
    draw(boss, frame, clock) {
      if (boss.windup !== 'dive') return;
      const { x: aimX, y: aimY } = boss.aim;
      const still = frame.look.still;
      pen.field();
      ctx.globalAlpha = frame.shown;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = LINE_WIDTH;
      marchDash(ctx, DASH, clock, DASH_SPEED, still);
      ctx.beginPath();
      ctx.moveTo(frame.x, frame.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      solidLines(ctx);
      const close = still ? 1 : 1 + RETICLE_CLOSE * Math.max(0, 1 - clock / RETICLE_CLOSE_SECONDS);
      pen.place(aimX, aimY, close, 0);
      pen.blit(baker.custom(key, RETICLE_RADIUS + 2, paint));
    },
  };
}
