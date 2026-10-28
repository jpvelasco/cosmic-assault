import { clamp } from '../content/curves';
import { BLACK_HOLE, HAZARD_RULES, WARP_RIFT } from '../content/hazards';
import type { Field } from '../sim/field';
import type { HazardState, PointHazardState, RiftState, ZoneState } from '../sim/hazards/hazard';
import { TAU } from '../sim/math';
import { BLACK, mix, rgba, WHITE } from './color';
import type { FieldPen } from './fieldPen';
import type { Palette } from './palette';
import type { SceneLook, Stamp } from './scene';
import { marchDash, solidLines, strokePath, type Sprite, type SpriteBaker } from './sprites';

export interface HazardPass {
  /**
   * The hazards in play. A gravity well: a faint outline closing in and pulsing while it is a warning; once it pulls,
   * a glow, three arcs swirling round it (held still and breathing under reduced motion) and a dark lens at its heart.
   * A repulsion field: a warning ring growing outward, then ripples spreading out from its heart. A warp rift, once
   * open: a swirl at each mouth linked by a dashed arc. A lethal danger zone: filled, hatched and outlined solid in the
   * hostile hue (its warning is `drawWarnings`'). A black hole: a dark lens with a bent-light halo and an accretion ring
   * turning over it (still under reduced motion), its warning a dashed ring in the hostile hue. Expects `source-over`,
   * which it leaves as it found it, with alpha 1.
   */
  drawHazards(hazards: readonly Readonly<HazardState>[], field: Field, look: SceneLook): void;
  /** The danger zones' and warp rifts' warnings, drawn over the rocks and foes so nothing hides one. */
  drawWarnings(hazards: readonly Readonly<HazardState>[], field: Field, look: SceneLook): void;
}

/**
 * The black hole: its dark lens is drawn at its true horizon, its bent-light halo and accretion ring at these multiples of
 * it, and its pull's glow over the field's middle. The ring is a flat ellipse, turning slowly; under reduced motion it holds still.
 */
const { telegraph: HOLE_TELEGRAPH_SECONDS, seconds: HOLE_SECONDS } = HAZARD_RULES.blackHole;
const HOLE_HORIZON = BLACK_HOLE.horizon;
/** The lens's halo and the accretion ring's reach, both the warning ring's radius (`BLACK_HOLE.warnRadius`). */
const HOLE_RING_RADIUS = BLACK_HOLE.warnRadius;
const HOLE_DISC_SQUASH = 0.32;
const HOLE_SPIN_RATE = 0.9;
const HOLE_GLOW_DIAMETER = 520;
const HOLE_GLOW_ALPHA = 0.45;

/** A repulsion field: its ripples, one a third of a cycle behind the next, spread out from it over this many seconds. */
const { telegraph: REPULSE_TELEGRAPH_SECONDS, seconds: REPULSE_SECONDS } = HAZARD_RULES.repulsionField;
const RIPPLES = 3;
const RIPPLE_SECONDS = 1.6;
/** A warp rift: its mouths are the well's swirl at this share of its size, and linked by a dashed arc that marches. */
const { telegraph: RIFT_TELEGRAPH_SECONDS, seconds: RIFT_SECONDS } = HAZARD_RULES.warpRift;
const RIFT_RADIUS = WARP_RIFT.radius;
const RIFT_LINK_DASH: number[] = [8, 6];
const RIFT_LINK_MARCH = 40;
const RIFT_LINK_WIDTH = 2;
const RIFT_LINK_BOW = 0.18;

const { telegraph: WELL_TELEGRAPH_SECONDS, seconds: WELL_SECONDS } = HAZARD_RULES.gravityWell;
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
/** Under reduced motion the arcs hold still and the swirl only breathes: this slowly, between this alpha and 1. */
const STILL_PULSE_HZ = 0.7;
const STILL_PULSE_LOW = 0.6;

/** The swirling arcs: radius share, how far round each sweeps, width, turn rate (rad/s; inner ones faster) and phase. */
const ARCS = [
  { reach: 0.42, sweep: 0.62, width: 5, rate: 2.1, phase: 0 },
  { reach: 0.68, sweep: 0.55, width: 6.5, rate: 1.3, phase: 2.1 },
  { reach: 0.94, sweep: 0.48, width: 7.5, rate: 0.75, phase: 4.2 },
] as const;
/** Segments per arc: each brighter and wider toward the head, so the arc trails off like a comet. */
const ARC_SEGMENTS = 28;
const HORIZON = 0.2;

const { telegraph: ZONE_TELEGRAPH_SECONDS, seconds: ZONE_SECONDS } = HAZARD_RULES.dangerZone;
/** A zone's hatching: the gap between its stripes, in field units, and the dash and gap of its warning outline. */
const HATCH_GAP = 16;
const ZONE_DASH = 14;
const ZONE_PAD = 4;
/** Seconds a zone takes to fill as it turns lethal and to fade as it ends; the warning pulses this fast. */
const ZONE_FILL_SECONDS = 0.25;
const ZONE_FADE_SECONDS = 0.5;
const ZONE_PULSE_HZ = 2.5;
/** Zone sprites are kept per zone id; past this many ids the oldest are forgotten. */
const ZONE_MEMORY = 16;

/** Diagonal stripes `HATCH_GAP` apart across the `w` by `h` rectangle centred on the origin. */
function hatch(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, width: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.clip();
  ctx.beginPath();
  for (let d = -h; d < w; d += HATCH_GAP) {
    ctx.moveTo(-w / 2 + d, h / 2);
    ctx.lineTo(-w / 2 + d + h, -h / 2);
  }
  strokePath(ctx, color, width);
  ctx.restore();
}

/** A zone's warning: a dashed outline, its corners marked solid, over faint hatching. */
function paintZoneWarning(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  hatch(ctx, w, h, rgba(color, 0.22), 2);
  ctx.setLineDash([ZONE_DASH, ZONE_DASH * 0.6]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.setLineDash([]);
  const corner = Math.min(w, h) * 0.18;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    ctx.moveTo((sx * w) / 2, (sy * h) / 2 - sy * corner);
    ctx.lineTo((sx * w) / 2, (sy * h) / 2);
    ctx.lineTo((sx * w) / 2 - sx * corner, (sy * h) / 2);
  }
  strokePath(ctx, mix(color, WHITE, 0.3), 3.5);
}

/** A lethal zone: filled and hatched in the hostile hue, outlined solid and bright. */
function paintZoneActive(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  ctx.fillStyle = rgba(color, 0.14);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  hatch(ctx, w, h, rgba(color, 0.45), 3);
  ctx.strokeStyle = rgba(color, 0.35);
  ctx.lineWidth = 8;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = mix(color, WHITE, 0.35);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
}

/** How strongly a lethal zone with `remaining` seconds to go is drawn: filling as it starts, fading as it ends. */
export function zonePresence(remaining: number): number {
  return Math.min(clamp((ZONE_SECONDS - remaining) / ZONE_FILL_SECONDS, 0, 1), clamp(remaining / ZONE_FADE_SECONDS, 0, 1));
}

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
    strokePath(ctx, rgba(t > 0.85 ? head : color, t * t * 0.95), width * (0.35 + 0.65 * t));
  }
}

/** A dashed ring: a warp rift's warning, drawn at `r` in `color`. */
function paintDashedRing(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  strokePath(ctx, rgba(color, 0.85), 2.5);
  ctx.setLineDash([]);
}

/** A ring that ripples outward from a repulsion field: a soft band with a bright rim. */
function paintRipple(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  strokePath(ctx, rgba(color, 0.3), 7);
  strokePath(ctx, mix(color, WHITE, 0.45), 1.8);
}

/** The dark lens at the well's heart, with a thin bright photon ring at its rim. */
function paintHorizon(ctx: CanvasRenderingContext2D, r: number, rim: string): void {
  const inner = HORIZON * r;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, inner * 1.9);
  gradient.addColorStop(0, rgba(BLACK, 0.95));
  gradient.addColorStop(0.5, rgba(BLACK, 0.85));
  gradient.addColorStop(1, rgba(BLACK, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(-inner * 2, -inner * 2, inner * 4, inner * 4);
  ctx.beginPath();
  ctx.arc(0, 0, inner * 1.05, 0, TAU);
  strokePath(ctx, rgba(mix(rim, WHITE, 0.6), 0.9), 1.6);
}

/** The black hole's lens: a bent-light halo just beyond the horizon, the dark disc within it and a bright photon ring at its rim. */
function paintLens(ctx: CanvasRenderingContext2D, rim: string): void {
  const halo = ctx.createRadialGradient(0, 0, HOLE_HORIZON, 0, 0, HOLE_RING_RADIUS);
  halo.addColorStop(0, rgba(rim, 0.5));
  halo.addColorStop(1, rgba(rim, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(-HOLE_RING_RADIUS, -HOLE_RING_RADIUS, HOLE_RING_RADIUS * 2, HOLE_RING_RADIUS * 2);
  const dark = ctx.createRadialGradient(0, 0, 0, 0, 0, HOLE_HORIZON * 1.1);
  dark.addColorStop(0, rgba(BLACK, 1));
  dark.addColorStop(0.85, rgba(BLACK, 0.97));
  dark.addColorStop(1, rgba(BLACK, 0));
  ctx.fillStyle = dark;
  ctx.fillRect(-HOLE_HORIZON * 1.1, -HOLE_HORIZON * 1.1, HOLE_HORIZON * 2.2, HOLE_HORIZON * 2.2);
  ctx.beginPath();
  ctx.arc(0, 0, HOLE_HORIZON * 1.02, 0, TAU);
  strokePath(ctx, rgba(mix(rim, WHITE, 0.6), 0.95), 2);
}

/** The accretion ring: a flat, glowing ellipse, with a hot head on one side that carries the turn. */
function paintDisc(ctx: CanvasRenderingContext2D, color: string): void {
  const rx = HOLE_RING_RADIUS;
  const ry = HOLE_RING_RADIUS * HOLE_DISC_SQUASH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  strokePath(ctx, rgba(color, 0.18), 10);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  strokePath(ctx, rgba(color, 0.7), 3.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, -0.6, 0.6);
  strokePath(ctx, rgba(mix(color, WHITE, 0.7), 0.95), 2.2);
}

/** The black hole's warning: a dashed ring where its accretion will be, and a solid one at its horizon. */
function paintHoleWarning(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.setLineDash([12, 9]);
  ctx.beginPath();
  ctx.arc(0, 0, HOLE_RING_RADIUS, 0, TAU);
  strokePath(ctx, rgba(color, 0.9), 2.5);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, HOLE_HORIZON, 0, TAU);
  strokePath(ctx, rgba(mix(color, WHITE, 0.4), 0.9), 1.6);
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
    strokePath(ctx, rgba(color, alpha), width);
  }
}

/**
 * How strongly an active hazard of `seconds` in all, with `remaining` to go, is drawn: building up as it starts, fading
 * as it ends.
 */
function presenceOf(remaining: number, seconds: number): number {
  return Math.min(clamp((seconds - remaining) / FADE_IN_SECONDS, 0, 1), clamp(remaining / FADE_OUT_SECONDS, 0, 1));
}

/** How strongly an active well with `remaining` seconds to go is drawn: swirling up as it starts, fading as it ends. */
export function wellPresence(remaining: number): number {
  return presenceOf(remaining, WELL_SECONDS);
}

/** The drawn size of a well of `intensity`, as a share of the baked sprites. */
const sizeOf = (intensity: number): number => (1 + INTENSITY_GROWTH * (intensity - 1)) / (1 + INTENSITY_GROWTH * (MAX_INTENSITY - 1));

/**
 * The gravity well from baked sprites only (no per-frame gradients, no `shadowBlur`): an additive glow and three
 * comet arcs turned a little each frame, over which sits the dark lens. Keys and painters are made once per palette.
 */
export function createHazardPass(ctx: CanvasRenderingContext2D, pen: FieldPen, stamp: Stamp, baker: SpriteBaker, palette: Palette): HazardPass {
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
  /** A warp rift's two mouths, set in place each frame: the entry and the exit of its pair. */
  const mouths: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  /** Draws `sprite` at (x, y), `size` of its baked size, turned by `angle`. */
  function put(sprite: Sprite, at: Readonly<{ x: number; y: number }>, size: number, angle: number, field: Field): void {
    stamp(sprite, at.x, at.y, Math.cos(angle) * size, Math.sin(angle) * size, sprite.halfW * size, field);
  }

  function drawWarning(well: Readonly<PointHazardState>, field: Field, { time, still }: SceneLook): void {
    const due = clamp(well.remaining / WELL_TELEGRAPH_SECONDS, 0, 1);
    const size = sizeOf(well.intensity) * (still ? 1 : 1 + OUTLINE_CLOSE * due);
    ctx.globalAlpha = still ? 0.5 : 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(time * TAU * OUTLINE_PULSE_HZ));
    put(baker.custom(outlineKey, half, paintOutlineNow), well, size, 0, field);
  }

  function drawActive(well: Readonly<PointHazardState>, field: Field, { glow, time, still }: SceneLook): void {
    const shown = wellPresence(well.remaining);
    const size = sizeOf(well.intensity);
    // Reduced motion freezes the swirl; a slow breath in its opacity still shows the well is pulling.
    const breath = still ? STILL_PULSE_LOW + (1 - STILL_PULSE_LOW) * (0.5 + 0.5 * Math.sin(time * TAU * STILL_PULSE_HZ)) : 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = GLOW_ALPHA * glow * shown * breath;
    put(baker.glow(violet, GLOW_DIAMETER), well, size, 0, field);
    ctx.globalAlpha = shown * breath;
    for (const arc of arcs) put(baker.custom(arc.key, half, arc.paint), well, size * (0.92 + 0.08 * shown), (still ? 0 : time * arc.rate) + arc.phase, field);
    ctx.globalCompositeOperation = 'source-over';
    if (shown > 0) put(baker.custom(horizonKey, half, paintHorizonNow), well, size * shown, 0, field);
  }

  const holeLensKey = `hole|${palette.id}|lens`;
  const holeDiscKey = `hole|${palette.id}|disc`;
  const holeWarnKey = `hole|${palette.id}|warn`;
  const [holeGlow, holeDisc, holeRim] = palette.accent;
  const paintLensNow = (c: CanvasRenderingContext2D): void => {
    paintLens(c, holeRim);
  };
  const paintDiscNow = (c: CanvasRenderingContext2D): void => {
    paintDisc(c, holeDisc);
  };
  const paintHoleWarnNow = (c: CanvasRenderingContext2D): void => {
    paintHoleWarning(c, palette.hostile);
  };
  const holeLensHalf = HOLE_RING_RADIUS + SPRITE_PAD;
  const holeDiscHalf = HOLE_RING_RADIUS + SPRITE_PAD;
  const holeDiscHalfH = HOLE_RING_RADIUS * HOLE_DISC_SQUASH + SPRITE_PAD;

  /**
   * An active black hole: its glow over the field, the dark lens at its horizon and the accretion ring turning over it.
   * Each is a baked sprite, and under reduced motion the ring holds still.
   */
  function drawHole(hole: Readonly<PointHazardState>, field: Field, { glow, time, still }: SceneLook): void {
    const shown = presenceOf(hole.remaining, HOLE_SECONDS);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = HOLE_GLOW_ALPHA * glow * shown;
    put(baker.glow(holeGlow, HOLE_GLOW_DIAMETER), hole, 1, 0, field);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = shown;
    put(baker.custom(holeLensKey, holeLensHalf, paintLensNow), hole, 1, 0, field);
    ctx.globalCompositeOperation = 'lighter';
    put(baker.custom(holeDiscKey, holeDiscHalf, paintDiscNow, holeDiscHalfH), hole, 1, still ? 0 : time * HOLE_SPIN_RATE, field);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A black hole's warning: its rings, pulsing faster as it comes due; still under reduced motion. */
  function drawHoleWarning(hole: Readonly<PointHazardState>, field: Field, { time, still }: SceneLook): void {
    const due = 1 - clamp(hole.remaining / HOLE_TELEGRAPH_SECONDS, 0, 1);
    ctx.globalAlpha = still ? 0.7 : 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(time * TAU * (OUTLINE_PULSE_HZ + 2 * due)));
    put(baker.custom(holeWarnKey, holeDiscHalf, paintHoleWarnNow), hole, 1, 0, field);
  }

  const rippleKey = `repulse|${palette.id}|ripple`;
  const repulseOutlineKey = `repulse|${palette.id}|outline`;
  const paintRippleNow = (c: CanvasRenderingContext2D): void => {
    paintRipple(c, BAKED_RADIUS, cyan);
  };
  const paintRepulseOutlineNow = (c: CanvasRenderingContext2D): void => {
    paintOutline(c, BAKED_RADIUS, cyan);
  };
  /** A rift's mouths reuse the well's arcs, horizon and glow at this share of their size. */
  const MOUTH_SCALE = (RIFT_RADIUS * 1.6) / BAKED_RADIUS;
  const riftOutlineKey = `rift|${palette.id}|outline`;
  const paintRiftOutlineNow = (c: CanvasRenderingContext2D): void => {
    paintDashedRing(c, BAKED_RADIUS, violet);
  };

  /** A repulsion field: a glow and ripples spreading out from it, a warning ring growing outward as it comes due. */
  function drawRepulsionWarning(force: Readonly<PointHazardState>, field: Field, { time, still }: SceneLook): void {
    const due = clamp(1 - force.remaining / REPULSE_TELEGRAPH_SECONDS, 0, 1);
    const size = sizeOf(force.intensity) * (still ? 1 : 0.5 + 0.5 * due);
    ctx.globalAlpha = still ? 0.5 : 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(time * TAU * OUTLINE_PULSE_HZ));
    put(baker.custom(repulseOutlineKey, half, paintRepulseOutlineNow), force, size, 0, field);
  }

  function drawRepulsion(force: Readonly<PointHazardState>, field: Field, { glow, time, still }: SceneLook): void {
    const shown = presenceOf(force.remaining, REPULSE_SECONDS);
    const size = sizeOf(force.intensity);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = GLOW_ALPHA * glow * shown * 0.6;
    put(baker.glow(cyan, GLOW_DIAMETER), force, size, 0, field);
    for (let k = 0; k < RIPPLES; k++) {
      // Each ripple spreads from the field's heart to its full reach, fading as it goes; still, they hold their places.
      const phase = still ? k / RIPPLES : ((time / RIPPLE_SECONDS + k / RIPPLES) % 1);
      ctx.globalAlpha = shown * (1 - phase) * 0.9;
      put(baker.custom(rippleKey, half, paintRippleNow), force, size * (0.15 + 0.85 * phase), 0, field);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A warp rift's warning: a dashed ring over each mouth, pulsing faster as the rift comes due. */
  function drawRiftWarning(rift: Readonly<RiftState>, field: Field, { time, still }: SceneLook): void {
    const due = 1 - clamp(rift.remaining / RIFT_TELEGRAPH_SECONDS, 0, 1);
    ctx.globalAlpha = still ? 0.6 : 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(time * TAU * (OUTLINE_PULSE_HZ + 2 * due)));
    placeMouths(rift);
    put(baker.custom(riftOutlineKey, half, paintRiftOutlineNow), mouths[0], MOUTH_SCALE, 0, field);
    put(baker.custom(riftOutlineKey, half, paintRiftOutlineNow), mouths[1], MOUTH_SCALE, 0, field);
    drawLink(rift, time, still, 0.35);
  }

  /** A warp rift open: each mouth a swirl of the well's arcs over a dark lens, the two linked by a dashed arc. */
  function drawRiftOpen(rift: Readonly<RiftState>, field: Field, { glow, time, still }: SceneLook): void {
    const shown = presenceOf(rift.remaining, RIFT_SECONDS);
    const breath = still ? STILL_PULSE_LOW + (1 - STILL_PULSE_LOW) * (0.5 + 0.5 * Math.sin(time * TAU * STILL_PULSE_HZ)) : 1;
    placeMouths(rift);
    drawLink(rift, time, still, shown * breath);
    // The two mouths turn in opposite ways, so the pair reads as a pair.
    drawMouth(mouths[0], 1, shown, breath, time, glow, still, field);
    drawMouth(mouths[1], -1, shown, breath, time, glow, still, field);
  }

  /** One of a warp rift's open mouths: a glow, the well's arcs turning at `turn` and a dark lens, all at `shown` and `breath`. */
  function drawMouth(mouth: Readonly<{ x: number; y: number }>, turn: number, shown: number, breath: number, time: number, glow: number, still: boolean, field: Field): void {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = GLOW_ALPHA * glow * shown * breath;
    put(baker.glow(violet, GLOW_DIAMETER), mouth, MOUTH_SCALE, 0, field);
    ctx.globalAlpha = shown * breath;
    for (const arc of arcs) put(baker.custom(arc.key, half, arc.paint), mouth, MOUTH_SCALE, (still ? 0 : turn * time * arc.rate) + arc.phase, field);
    ctx.globalCompositeOperation = 'source-over';
    if (shown > 0) put(baker.custom(horizonKey, half, paintHorizonNow), mouth, MOUTH_SCALE * shown, 0, field);
  }

  /** Sets `mouths` to where a warp rift's two mouths sit. */
  function placeMouths(rift: Readonly<RiftState>): void {
    mouths[0].x = rift.x;
    mouths[0].y = rift.y;
    mouths[1].x = rift.toX;
    mouths[1].y = rift.toY;
  }

  /** The dashed arc between a rift's mouths, bowed a little to one side and marching toward the far mouth. */
  function drawLink(rift: Readonly<RiftState>, time: number, still: boolean, alpha: number): void {
    if (alpha <= 0) return;
    pen.field();
    const mx = (rift.x + rift.toX) / 2;
    const my = (rift.y + rift.toY) / 2;
    const bow = RIFT_LINK_BOW * Math.hypot(rift.toX - rift.x, rift.toY - rift.y);
    const nx = -(rift.toY - rift.y);
    const ny = rift.toX - rift.x;
    const length = Math.hypot(nx, ny) || 1;
    ctx.beginPath();
    ctx.moveTo(rift.x, rift.y);
    ctx.quadraticCurveTo(mx + (nx / length) * bow * 2, my + (ny / length) * bow * 2, rift.toX, rift.toY);
    marchDash(ctx, RIFT_LINK_DASH, time, RIFT_LINK_MARCH, still);
    ctx.lineWidth = RIFT_LINK_WIDTH;
    ctx.strokeStyle = violet;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    solidLines(ctx);
    ctx.globalAlpha = 1;
  }

  const zoneColor = palette.hostile;
  /** Each zone's two sprites, keyed and painted at its own size, made once as it is first drawn. */
  const zoneArt = new Map<number, { readonly warning: string; readonly active: string; readonly paintWarning: (c: CanvasRenderingContext2D) => void; readonly paintActive: (c: CanvasRenderingContext2D) => void }>();

  function artOf(zone: Readonly<ZoneState>) {
    const known = zoneArt.get(zone.id);
    if (known !== undefined) return known;
    if (zoneArt.size >= ZONE_MEMORY) zoneArt.clear();
    const size = `${zone.w.toFixed(1)}x${zone.h.toFixed(1)}`;
    const art = {
      warning: `zone|${palette.id}|warning|${size}`,
      active: `zone|${palette.id}|active|${size}`,
      paintWarning: (c: CanvasRenderingContext2D): void => {
        paintZoneWarning(c, zone.w, zone.h, zoneColor);
      },
      paintActive: (c: CanvasRenderingContext2D): void => {
        paintZoneActive(c, zone.w, zone.h, zoneColor);
      },
    };
    zoneArt.set(zone.id, art);
    return art;
  }

  function drawZone(zone: Readonly<ZoneState>, field: Field, { time, still }: SceneLook): void {
    const art = artOf(zone);
    const warning = zone.stage === 'warning';
    const sprite = warning ? baker.custom(art.warning, zone.w / 2 + ZONE_PAD, art.paintWarning, zone.h / 2 + ZONE_PAD) : baker.custom(art.active, zone.w / 2 + ZONE_PAD, art.paintActive, zone.h / 2 + ZONE_PAD);
    // A warning pulses faster as it comes due; reduced motion holds it steady.
    const due = 1 - clamp(zone.remaining / ZONE_TELEGRAPH_SECONDS, 0, 1);
    ctx.globalAlpha = warning ? (still ? 0.75 : 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(time * TAU * ZONE_PULSE_HZ * (1 + due)))) : zonePresence(zone.remaining);
    stamp(sprite, zone.x, zone.y, 1, 0, Math.max(zone.w, zone.h) / 2, field);
  }

  return {
    drawHazards(hazards, field, look) {
      for (const hazard of hazards) {
        if (hazard.type === 'dangerZone') {
          if (hazard.stage === 'active') drawZone(hazard, field, look);
        } else if (hazard.type === 'gravityWell') (hazard.stage === 'warning' ? drawWarning : drawActive)(hazard, field, look);
        else if (hazard.type === 'repulsionField') {
          if (hazard.stage === 'warning') drawRepulsionWarning(hazard, field, look);
          else drawRepulsion(hazard, field, look);
        } else if (hazard.type === 'warpRift' && hazard.stage === 'active') drawRiftOpen(hazard, field, look);
        else if (hazard.type === 'blackHole' && hazard.stage === 'active') drawHole(hazard, field, look);
        ctx.globalAlpha = 1;
      }
    },
    drawWarnings(hazards, field, look) {
      for (const hazard of hazards) {
        if (hazard.type === 'dangerZone' && hazard.stage === 'warning') drawZone(hazard, field, look);
        else if (hazard.type === 'warpRift' && hazard.stage === 'warning') drawRiftWarning(hazard, field, look);
        else if (hazard.type === 'blackHole' && hazard.stage === 'warning') drawHoleWarning(hazard, field, look);
      }
      ctx.globalAlpha = 1;
    },
  };
}
