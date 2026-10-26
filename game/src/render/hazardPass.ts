import { clamp } from '../content/curves';
import { WELL_SECONDS, WELL_TELEGRAPH_SECONDS } from '../content/hazards';
import type { Field } from '../sim/field';
import type { WellState } from '../sim/hazards/gravityWell';
import { TAU } from '../sim/math';
import { mix, rgba } from './color';
import type { Palette } from './palette';
import type { SceneLook, Stamp } from './scene';
import type { Sprite, SpriteBaker } from './sprites';

export interface HazardPass {
  /**
   * A gravity well: a faint outline closing in and pulsing while it is a warning; once it pulls, a glow, three arcs
   * swirling round it and a dark lens at its heart. Expects `source-over`, which it leaves as it found it, with alpha 1.
   */
  drawWell(well: Readonly<WellState> | null, field: Field, look: SceneLook): void;
}

const WHITE = '#ffffff';
/** The drawn radius of an intensity-1 well; its pull reaches the whole field and has no edge. Each intensity adds a share. */
const WELL_RADIUS = 90;
const INTENSITY_GROWTH = 0.2;
const MAX_INTENSITY = 3;
/** Sprites are baked for the largest well and drawn scaled down for the others, so they are never blown up. */
const BAKED_RADIUS = WELL_RADIUS * (1 + INTENSITY_GROWTH * (MAX_INTENSITY - 1));
const SPRITE_PAD = 4;
const GLOW_DIAMETER = BAKED_RADIUS * 2.6;
const GLOW_ALPHA = 0.7;
/** The warning outline starts this much wider and closes onto the well as it comes due, pulsing this fast. */
const OUTLINE_CLOSE = 0.3;
const OUTLINE_PULSE_HZ = 2;
/** Seconds the well takes to swirl up as it starts and to fade as it ends. */
const FADE_IN_SECONDS = 0.5;
const FADE_OUT_SECONDS = 0.8;

/** The swirling arcs: radius share, how far round each sweeps, width, turn rate (rad/s; inner ones faster) and phase. */
const ARCS = [
  { reach: 0.42, sweep: 0.62, width: 5, rate: 2.1, phase: 0 },
  { reach: 0.68, sweep: 0.55, width: 6.5, rate: 1.3, phase: 2.1 },
  { reach: 0.94, sweep: 0.48, width: 7.5, rate: 0.75, phase: 4.2 },
] as const;
/** Segments per arc: each brighter and wider toward the head, so the arc trails off like a comet. */
const ARC_SEGMENTS = 28;
const HORIZON = 0.2;

/** A comet arc round the centre at radius `r`, its head at angle 0, sweeping `sweep` of a turn behind it. */
function paintArc(ctx: CanvasRenderingContext2D, r: number, sweep: number, width: number, color: string): void {
  const head = mix(color, WHITE, 0.55);
  ctx.lineCap = 'round';
  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const t = (i + 1) / ARC_SEGMENTS;
    const from = -(1 - i / ARC_SEGMENTS) * sweep * TAU;
    const to = -(1 - t) * sweep * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, r, from, to + 0.02);
    ctx.strokeStyle = rgba(t > 0.85 ? head : color, t * t * 0.95);
    ctx.lineWidth = width * (0.35 + 0.65 * t);
    ctx.stroke();
  }
}

/** The dark lens at the well's heart, with a thin bright photon ring at its rim. */
function paintHorizon(ctx: CanvasRenderingContext2D, r: number, rim: string): void {
  const inner = HORIZON * r;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, inner * 1.9);
  gradient.addColorStop(0, rgba('#000000', 0.95));
  gradient.addColorStop(0.5, rgba('#000000', 0.85));
  gradient.addColorStop(1, rgba('#000000', 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(-inner * 2, -inner * 2, inner * 4, inner * 4);
  ctx.beginPath();
  ctx.arc(0, 0, inner * 1.05, 0, TAU);
  ctx.strokeStyle = rgba(mix(rim, WHITE, 0.6), 0.9);
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

/** The warning: a thin ring with a fainter halo either side of it. */
function paintOutline(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  for (const [width, alpha] of [
    [9, 0.12],
    [4, 0.3],
    [1.6, 0.95],
  ] as const) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** How strongly an active well with `remaining` seconds to go is drawn: swirling up as it starts, fading as it ends. */
export function wellPresence(remaining: number): number {
  return Math.min(clamp((WELL_SECONDS - remaining) / FADE_IN_SECONDS, 0, 1), clamp(remaining / FADE_OUT_SECONDS, 0, 1));
}

/** The drawn size of a well of `intensity`, as a share of the baked sprites. */
const sizeOf = (intensity: number): number => (1 + INTENSITY_GROWTH * (intensity - 1)) / (1 + INTENSITY_GROWTH * (MAX_INTENSITY - 1));

/**
 * The gravity well from baked sprites only (no per-frame gradients, no `shadowBlur`): an additive glow and three
 * comet arcs turned a little each frame, over which sits the dark lens. Keys and painters are made once per palette.
 */
export function createHazardPass(ctx: CanvasRenderingContext2D, stamp: Stamp, baker: SpriteBaker, palette: Palette): HazardPass {
  const [cyan, violet] = palette.accent;
  const arcColors = [mix(cyan, WHITE, 0.3), cyan, violet];
  const arcs = ARCS.map(({ reach, sweep, width, rate, phase }, i) => ({
    key: `well|${palette.id}|arc${String(i)}`,
    rate,
    phase,
    paint: (c: CanvasRenderingContext2D): void => {
      paintArc(c, reach * BAKED_RADIUS, sweep, width, arcColors[i] ?? violet);
    },
  }));
  const horizonKey = `well|${palette.id}|horizon`;
  const outlineKey = `well|${palette.id}|outline`;
  const paintHorizonNow = (c: CanvasRenderingContext2D): void => {
    paintHorizon(c, BAKED_RADIUS, violet);
  };
  const paintOutlineNow = (c: CanvasRenderingContext2D): void => {
    paintOutline(c, BAKED_RADIUS, mix(violet, WHITE, 0.35));
  };
  const half = BAKED_RADIUS + SPRITE_PAD;

  /** Draws `sprite` at the well, `size` of its baked size, turned by `angle`. */
  function put(sprite: Sprite, well: Readonly<WellState>, size: number, angle: number, field: Field): void {
    stamp(sprite, well.x, well.y, Math.cos(angle) * size, Math.sin(angle) * size, sprite.halfW * size, field);
  }

  function drawWarning(well: Readonly<WellState>, field: Field, { time, still }: SceneLook): void {
    const due = clamp(well.remaining / WELL_TELEGRAPH_SECONDS, 0, 1);
    const size = sizeOf(well.intensity) * (still ? 1 : 1 + OUTLINE_CLOSE * due);
    ctx.globalAlpha = still ? 0.5 : 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(time * TAU * OUTLINE_PULSE_HZ));
    put(baker.custom(outlineKey, half, paintOutlineNow), well, size, 0, field);
  }

  function drawActive(well: Readonly<WellState>, field: Field, { glow, time }: SceneLook): void {
    const shown = wellPresence(well.remaining);
    const size = sizeOf(well.intensity);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = GLOW_ALPHA * glow * shown;
    const halo = baker.glow(violet, GLOW_DIAMETER);
    put(halo, well, size, 0, field);
    ctx.globalAlpha = shown;
    // Even under reduced motion the arcs turn: the swirl shows the well is pulling, and it is slow.
    for (const arc of arcs) put(baker.custom(arc.key, half, arc.paint), well, size * (0.92 + 0.08 * shown), time * arc.rate + arc.phase, field);
    ctx.globalCompositeOperation = 'source-over';
    if (shown > 0) put(baker.custom(horizonKey, half, paintHorizonNow), well, size * shown, 0, field);
  }

  return {
    drawWell(well, field, look) {
      if (well === null) return;
      if (well.stage === 'warning') drawWarning(well, field, look);
      else drawActive(well, field, look);
      ctx.globalAlpha = 1;
    },
  };
}
