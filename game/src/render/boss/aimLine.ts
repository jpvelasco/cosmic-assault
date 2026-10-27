import type { BossView } from '../../sim/boss/behaviour';
import { TAU } from '../../sim/math';
import { mix, rgba } from '../color';
import type { BossFrame, DrawerKit } from './drawer';

/** A dive's aim line, as the boss pass draws it. */
export interface AimLine {
  /** Draws the line for `boss` winding up a dive `clock` seconds in; forgets the aim once it is not. */
  draw(boss: Readonly<BossView>, frame: Readonly<BossFrame>, clock: number): void;
  /** Forgets the aim, for a new fight. */
  reset(): void;
}

const WHITE = '#ffffff';
/** The dashes of the line, in field units, and how fast they march toward the aim unless held still. */
const DASH = [14, 10];
const NO_DASH: number[] = [];
const DASH_SPEED = 120;
const LINE_WIDTH = 3;
/** The reticle at the aim: its radius, and how it closes in as the windup runs. */
const RETICLE_RADIUS = 26;
const RETICLE_CLOSE = 0.6;
const RETICLE_CLOSE_SECONDS = 0.7;

/** The reticle at radius `r`: a broken ring with four ticks pointing in. */
function paintReticle(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + TAU / 8;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, a - 0.5, a + 0.5);
    ctx.stroke();
    const t = a - TAU / 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(t) * r, Math.sin(t) * r);
    ctx.lineTo(Math.cos(t) * r * 0.55, Math.sin(t) * r * 0.55);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(mix(color, WHITE, 0.6), 0.9);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 0, TAU);
  ctx.stroke();
}

/**
 * The aim line a dive shows through its windup, in the Dimension's hostile hue: a dashed line from the core to where the
 * ship was as the windup began, marching toward it, and a reticle there closing in as the dive nears. Where the ship
 * was is read from the first frame of the windup, as the sim read it then. Strokes no path and bakes nothing outside a
 * dive's windup, and allocates nothing as it draws.
 */
export function createAimLine({ ctx, pen, baker, palette }: DrawerKit): AimLine {
  const color = palette.accent[0];
  const stroke = rgba(color, 0.85);
  const key = `boss|${palette.id}|aim|reticle`;
  const paint = (c: CanvasRenderingContext2D): void => {
    paintReticle(c, RETICLE_RADIUS, color);
  };
  let aiming = false;
  let aimX = 0;
  let aimY = 0;
  return {
    draw(boss, frame, clock) {
      if (boss.windup !== 'dive') {
        aiming = false;
        return;
      }
      if (!aiming) {
        aiming = true;
        aimX = frame.look.aimX;
        aimY = frame.look.aimY;
      }
      const still = frame.look.still;
      pen.field();
      ctx.globalAlpha = frame.shown;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = LINE_WIDTH;
      ctx.setLineDash(DASH);
      ctx.lineDashOffset = still ? 0 : -clock * DASH_SPEED;
      ctx.beginPath();
      ctx.moveTo(frame.x, frame.y);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      const close = still ? 1 : 1 + RETICLE_CLOSE * Math.max(0, 1 - clock / RETICLE_CLOSE_SECONDS);
      pen.place(aimX, aimY, close, 0);
      pen.blit(baker.custom(key, RETICLE_RADIUS + 2, paint));
    },
    reset() {
      aiming = false;
    },
  };
}
