import { BOLT } from '../content/foes';
import type { Field } from '../sim/field';
import type { Bolt } from '../sim/foes/bolts';
import { mix, rgba } from './color';
import { interpolatePose } from './interp';
import type { Palette } from './palette';
import { createZoom, type SceneLook, type Stamp } from './scene';
import { addStops, paintGlow, type SpriteBaker } from './sprites';

export interface BoltPass {
  /** The hostile bolts, `alpha` of the way from their previous pose: a glow under each, then its capsule along its flight. */
  drawBolts(bolts: readonly Readonly<Bolt>[], alpha: number, field: Field, look: SceneLook): void;
}

const WHITE = '#ffffff';
/** The capsule's half-length along its flight and its half-width across it, as shares of the bolt's radius. */
const HALF_LENGTH = 2;
const HALF_WIDTH = 0.95;
/** The glow under a bolt: its diameter as a multiple of the radius, and its alpha at full quality. */
const GLOW_SCALE = 6;
const GLOW_ALPHA = 0.55;
/** Room around the capsule for its baked halo, in field units. */
const SPRITE_PAD = 4;

/** The bolt's sprite cache key in `palette`, made once so drawing builds no strings. */
export const boltKey = (palette: Palette): string => `bolt|${palette.id}`;

/** The bolt: a glossy capsule along +x in the palette's hostile hue, rimmed dark, a white-hot core down its middle. */
function paintBolt(ctx: CanvasRenderingContext2D, p: Palette): void {
  const hue = p.hostile;
  const r = BOLT.radius;
  const [half, width] = [HALF_LENGTH * r, HALF_WIDTH * r];
  ctx.globalCompositeOperation = 'lighter';
  paintGlow(ctx, hue, 0, 0, half + SPRITE_PAD, 0.6);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.roundRect(-half, -width, half * 2, width * 2, width);
  ctx.fillStyle = addStops(ctx.createLinearGradient(0, width, 0, -width), [mix(hue, '#000000', 0.35), hue, mix(hue, WHITE, 0.5)], [0, 0.5, 1]);
  ctx.fill();
  // A dark rim, then a light one inside it: the capsule reads against anything of its own hue, a lethal zone included.
  ctx.strokeStyle = rgba(mix(hue, '#000000', 0.8), 0.9);
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.strokeStyle = rgba(WHITE, 0.55);
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-half * 0.7, -width * 0.38, half * 1.4, width * 0.76, width * 0.38);
  ctx.fillStyle = WHITE;
  ctx.fill();
}

/**
 * Draws the hostile bolts from one baked glossy sprite per palette (no `shadowBlur`): an additive glow in the hostile
 * hue, then the capsule turned along the bolt's flight. The key and painter are made once and the sprite is baked at
 * the layout's visual scale, so a frame of drawing allocates nothing.
 */
export function createBoltPass(ctx: CanvasRenderingContext2D, stamp: Stamp, baker: SpriteBaker, palette: Palette): BoltPass {
  const key = boltKey(palette);
  const glowColor = palette.hostile;
  const zoom = createZoom();
  const painter = zoom.wrap((c) => {
    paintBolt(c, palette);
  });
  const pose = { x: 0, y: 0, angle: 0 };
  return {
    drawBolts(bolts, alpha, field, { visual, glow }) {
      if (bolts.length === 0) return;
      zoom.value = visual.shot;
      const reach = BOLT.radius * GLOW_SCALE * zoom.value;
      // Looked up once a frame, which keeps the per-bolt loop to drawing.
      const halo = baker.glow(glowColor, reach);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = GLOW_ALPHA * glow;
      for (const bolt of bolts) {
        interpolatePose(bolt.px, bolt.py, 0, bolt.x, bolt.y, 0, alpha, field, pose);
        stamp(halo, pose.x, pose.y, 1, 0, reach / 2, field);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const sprite = baker.custom(key, (HALF_LENGTH * BOLT.radius + SPRITE_PAD) * zoom.value, painter);
      for (const bolt of bolts) {
        interpolatePose(bolt.px, bolt.py, 0, bolt.x, bolt.y, 0, alpha, field, pose);
        const speed = Math.hypot(bolt.vx, bolt.vy) || 1;
        stamp(sprite, pose.x, pose.y, bolt.vx / speed, bolt.vy / speed, sprite.halfW, field);
      }
    },
  };
}
