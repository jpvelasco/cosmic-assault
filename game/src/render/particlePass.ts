import { TAU } from '../sim/math';
import type { FieldPen } from './fieldPen';
import type { Particle, ParticlePool } from './particles';
import type { SpriteBaker } from './sprites';

export interface ParticlePass {
  /** Expanding rings, drawn additively under the rocks. The caller sets `'lighter'`; leaves alpha at 1. `zoom` enlarges them, not their positions. */
  drawRings(zoom: number): void;
  /** Smoke and shards (normal blend), then trail glows and sparks (additive). Leaves `source-over` and alpha 1. `zoom` as for rings. */
  drawBursts(zoom: number): void;
}

const WHITE = '#ffffff';
/** The field is larger on screen than the mockup's, so rings run thicker to read at the same weight. */
const RING_MAX_WIDTH = 6;
const RING_MIN_WIDTH = 1.5;
const SHARD_ASPECT = 0.7;
const SHARD_EDGE_ALPHA = 0.7;
const SMOKE_ALPHA = 0.35;
const TRAIL_GLOW_SCALE = 3;
const SPARK_TAIL_SECONDS = 0.04;
const SPARK_WIDTH = 2.5;
/** Sparks stay at full brightness until their fade falls below 1 / SPARK_HOLD, then fade out. */
const SPARK_HOLD = 1.6;

const fade = (p: Readonly<Particle>): number => p.life / p.max;

/**
 * Draws the particle pool in blend groups. The visitors are made once, so drawing allocates no
 * closures. Particles do not wrap, so they skip the wrap copies.
 */
export function createParticlePass(
  ctx: CanvasRenderingContext2D,
  pen: FieldPen,
  baker: SpriteBaker,
  particles: ParticlePool,
): ParticlePass {
  let zoom = 1;
  const drawRing = (p: Readonly<Particle>): void => {
    if (p.kind !== 'ring') return;
    const f = fade(p);
    ctx.globalAlpha = f;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = (RING_MAX_WIDTH * f + RING_MIN_WIDTH) * zoom;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * zoom * (1 - f), 0, TAU);
    ctx.stroke();
  };
  const drawDebris = (p: Readonly<Particle>): void => {
    if (p.kind === 'smoke') {
      ctx.globalAlpha = fade(p) * SMOKE_ALPHA;
      pen.place(p.x, p.y, 1, 0);
      pen.blit(baker.glow(p.color, p.size * 2 * zoom));
    } else if (p.kind === 'shard') {
      const f = fade(p);
      const s = p.size * zoom;
      pen.place(p.x, p.y, Math.cos(p.rot), Math.sin(p.rot));
      ctx.globalAlpha = f;
      ctx.fillStyle = p.color;
      ctx.fillRect(-s / 2, -s / 2, s, s * SHARD_ASPECT);
      ctx.globalAlpha = f * SHARD_EDGE_ALPHA;
      ctx.fillStyle = WHITE;
      ctx.fillRect(-s / 2, -s / 2, s, 1);
    }
  };
  const drawTrailGlow = (p: Readonly<Particle>): void => {
    if (p.kind !== 'glow') return;
    ctx.globalAlpha = fade(p);
    pen.place(p.x, p.y, 1, 0);
    pen.blit(baker.glow(p.color, p.size * TRAIL_GLOW_SCALE * zoom));
  };
  const drawSpark = (p: Readonly<Particle>): void => {
    if (p.kind !== 'spark') return;
    ctx.globalAlpha = Math.min(1, fade(p) * SPARK_HOLD);
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * SPARK_TAIL_SECONDS, p.y - p.vy * SPARK_TAIL_SECONDS);
    ctx.stroke();
  };

  return {
    drawRings(scale) {
      zoom = scale;
      pen.field();
      particles.forEach(drawRing);
      ctx.globalAlpha = 1;
    },
    drawBursts(scale) {
      zoom = scale;
      ctx.globalCompositeOperation = 'source-over';
      particles.forEach(drawDebris);
      ctx.globalCompositeOperation = 'lighter';
      particles.forEach(drawTrailGlow);
      pen.field();
      ctx.lineWidth = SPARK_WIDTH * zoom;
      ctx.lineCap = 'round';
      particles.forEach(drawSpark);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}
