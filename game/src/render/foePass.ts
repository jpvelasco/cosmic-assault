import type { FoeKind } from '../content/types';
import { FOES } from '../content/foes';
import type { Field } from '../sim/field';
import type { Foe } from '../sim/foes/foe';
import type { WellState } from '../sim/hazards/gravityWell';
import { TAU } from '../sim/math';
import { rgba } from './color';
import { HIT_FLASH_SECONDS, type FoeFlash } from './hitFlash';
import { interpolatePose } from './interp';
import type { Palette } from './palette';
import type { Sprite, SpriteBaker } from './sprites';

/** Draws a sprite centred at (x, y), turned by (cos, sin), with the wrap copies an entity of `radius` needs. */
export type Stamp = (sprite: Sprite, x: number, y: number, cos: number, sin: number, radius: number, field: Field) => void;

export interface FoePass {
  /** The foes, `alpha` of the way from their previous pose. */
  drawFoes(foes: readonly Readonly<Foe>[], alpha: number, field: Field): void;
  /** The white silhouettes of foes just hurt, fading over their flash. */
  drawFlashes(flashes: readonly Readonly<FoeFlash>[], field: Field): void;
  /** A gravity well: a thin ring while it is only a warning, a glowing one while it pulls. */
  drawWell(well: Readonly<WellState> | null, glow: number, field: Field): void;
}

/** The size the well is drawn at; its pull reaches the whole field and has no edge. */
const WELL_DRAWN_RADIUS = 110;
const WELL_WARNING_ALPHA = 0.55;
const WELL_ACTIVE_ALPHA = 0.9;
const WELL_GLOW_ALPHA = 0.5;
const SPRITE_PAD = 2;

/** Sprite cache keys, made once so drawing builds no strings. */
const FOE_KEYS: Readonly<Record<FoeKind, string>> = { splitter: 'foe|splitter', drone: 'foe|drone' };
const WELL_KEY = 'well|ring';

function disc(ctx: CanvasRenderingContext2D, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Plain placeholder art, drawn from baked sprites: a disc per foe (the drone with a nose to show its heading) and a
 * ring for the well. The glossy foe and well sprites replace the painters.
 */
export function createFoePass(ctx: CanvasRenderingContext2D, stamp: Stamp, baker: SpriteBaker, palette: Palette): FoePass {
  const painters: Readonly<Record<FoeKind, (c: CanvasRenderingContext2D) => void>> = {
    splitter: (c) => {
      disc(c, FOES.splitter.radius, palette.accent[1]);
      c.strokeStyle = rgba('#ffffff', 0.7);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-12, -8);
      c.lineTo(2, 4);
      c.lineTo(12, -2);
      c.stroke();
    },
    drone: (c) => {
      disc(c, FOES.drone.radius, palette.accent[0]);
      disc(c, FOES.drone.radius * 0.45, '#ffffff');
      c.fillStyle = '#ffffff';
      c.fillRect(FOES.drone.radius * 0.6, -2, FOES.drone.radius * 0.6, 4);
    },
  };
  const paintRing = (c: CanvasRenderingContext2D): void => {
    c.beginPath();
    c.arc(0, 0, WELL_DRAWN_RADIUS, 0, TAU);
    c.strokeStyle = palette.accent[1];
    c.lineWidth = 4;
    c.stroke();
  };
  const pose = { x: 0, y: 0, angle: 0 };

  return {
    drawFoes(foes, alpha, field) {
      for (const foe of foes) {
        // Spent this step and not yet swept: its burst is the picture now.
        if (foe.hp <= 0) continue;
        interpolatePose(foe.px, foe.py, foe.protation, foe.x, foe.y, foe.rotation, alpha, field, pose);
        const sprite = baker.custom(FOE_KEYS[foe.kind], foe.radius + SPRITE_PAD, painters[foe.kind]);
        stamp(sprite, pose.x, pose.y, Math.cos(pose.angle), Math.sin(pose.angle), foe.radius, field);
      }
    },
    drawFlashes(flashes, field) {
      for (const { kind, x, y, left } of flashes) {
        // Looked up each frame: a rebake may have freed the silhouette since the hit. Skipped, never drawn empty.
        const sprite = baker.white(FOE_KEYS[kind]);
        if (sprite === undefined || sprite.canvas.width === 0) continue;
        ctx.globalAlpha = left / HIT_FLASH_SECONDS;
        stamp(sprite, x, y, 1, 0, sprite.halfW, field);
      }
      ctx.globalAlpha = 1;
    },
    drawWell(well, glow, field) {
      if (well === null) return;
      const active = well.stage === 'active';
      if (active) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = WELL_GLOW_ALPHA * glow;
        stamp(baker.glow(palette.accent[1], WELL_DRAWN_RADIUS * 2), well.x, well.y, 1, 0, WELL_DRAWN_RADIUS, field);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = active ? WELL_ACTIVE_ALPHA : WELL_WARNING_ALPHA;
      stamp(baker.custom(WELL_KEY, WELL_DRAWN_RADIUS + SPRITE_PAD, paintRing), well.x, well.y, 1, 0, WELL_DRAWN_RADIUS, field);
      ctx.globalAlpha = 1;
    },
  };
}
