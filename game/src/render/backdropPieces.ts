import type { Field } from '../sim/field';
import type { Rng } from '../sim/rng';
import { PIECE_SLOTS, type BackdropSpec, type PieceId } from './backdropSpec';
import { rgba } from './color';
import type { Palette } from './palette';

/** A box as fractions of the field: x0/y0 the top-left corner, x1/y1 the bottom-right. */
export interface FractionBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A piece's circle in field units; every painter draws round shapes from it. */
export interface PieceShape {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** No painted alpha, colour or gradient stop, may exceed this. */
export const PIECE_ALPHA_MAX = 0.55;

/**
 * Where a piece may not paint. The centre ellipse (x 0.3 to 0.7, y 0.25 to 0.75) is held as its bounding rectangle, which
 * is slightly wider than the ellipse, so the test is conservative; the top corners are the two rectangles above y 0.12
 * outside x 0.3 to 0.7. Every spec's box is tested against these, so the rule lives here and nowhere else.
 */
export const KEEP_OUT: readonly FractionBox[] = [
  { x0: 0.3, y0: 0.25, x1: 0.7, y1: 0.75 },
  { x0: 0, y0: 0, x1: 0.3, y1: 0.12 },
  { x0: 0.7, y0: 0, x1: 1, y1: 0.12 },
];

/** The inner edges of the side bands: the centre keep-out's left and right sides. */
const INNER_LEFT = 0.28;
const INNER_RIGHT = 0.72;
const BAND_LEFT: readonly [number, number] = [0.06, INNER_LEFT];
const BAND_RIGHT: readonly [number, number] = [INNER_RIGHT, 0.94];
const TOP_CORNER_BOTTOM = 0.12;
/** The rows a small piece is centred in, in the side bands (see `pieceBox`). */
const ROW_TOP = 0.2;
const ROW_BOTTOM = 0.85;
/** The region a painter may paint in (see `paintBandFor`): wider than the rows, so no painter is cut by its row. */
const BAND_TOP = TOP_CORNER_BOTTOM;
const BAND_BOTTOM = 0.95;
/** A small piece's diameter in field heights; its width is the same in field units, so it stays round at any aspect. */
const SMALL_DIAMETER = 0.2;
const BOSS_SCALE = 1.7;
const TAU = Math.PI * 2;

/** Float error allowed on an edge: a box that touches a keep-out edge is clear, even when its computed edge lands a hair inside. */
const EDGE_EPS = 1e-9;

/** Whether `box` clears every keep-out rectangle (touching an edge is clear). */
export function clearsKeepOut(box: FractionBox): boolean {
  return KEEP_OUT.every(
    (zone) => box.x0 >= zone.x1 - EDGE_EPS || box.x1 <= zone.x0 + EDGE_EPS || box.y0 >= zone.y1 - EDGE_EPS || box.y1 <= zone.y0 + EDGE_EPS,
  );
}

/** A piece's centre (fractions of the field) and radius (in field heights, so it stays round at any aspect). */
export interface PieceFit {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** How far a piece's paint reaches from its centre on each axis, in fractions of the field: `factor` (its `REACH`) times r. */
function reachOf(factor: number, r: number, aspect: number): { readonly x: number; readonly y: number } {
  return { x: (factor * r) / aspect, y: factor * r };
}

/**
 * Where a piece sits and how big it is, for a field of width/height `aspect`. The piece is centred on its side band's row
 * (the band is cut into `PIECE_SLOTS` equal rows), with its radius at the nominal size. Its painted box (`pieceBox`) must
 * fit its paint band: if that box is still too large the radius shrinks to the band, `r = min(nominal, band / (2 × reach))`
 * on the limiting axis, and the centre moves in until the box fits. A boss piece is anchored so its inner edge lands on the
 * band's inner edge; its outer side may run off the field, as a horizon limb does.
 */
export function pieceFit(spec: BackdropSpec, aspect: number, boss: boolean): PieceFit {
  const band = paintBandFor(spec, boss);
  const factor = REACH[spec.piece];
  const nominal = (SMALL_DIAMETER / 2) * (boss ? BOSS_SCALE : 1);
  const across = boss ? Infinity : ((band.x1 - band.x0) * aspect) / (2 * factor);
  const r = Math.min(nominal, across, (band.y1 - band.y0) / (2 * factor));
  const reach = reachOf(factor, r, aspect);
  const [left, right] = spec.side === 'left' ? BAND_LEFT : BAND_RIGHT;
  const row = (ROW_BOTTOM - ROW_TOP) / PIECE_SLOTS;
  const cy = clamp(ROW_TOP + (spec.slot + 0.5) * row, band.y0 + reach.y, band.y1 - reach.y);
  if (boss) return { cx: spec.side === 'left' ? band.x1 - reach.x : band.x0 + reach.x, cy, r };
  return { cx: clamp((left + right) / 2, band.x0 + reach.x, band.x1 - reach.x), cy, r };
}

/** The box a piece's paint covers, as fractions of the field: `pieceFit`'s centre with its reach on each axis. */
export function pieceBox(spec: BackdropSpec, aspect: number, boss: boolean): FractionBox {
  const { cx, cy, r } = pieceFit(spec, aspect, boss);
  const reach = reachOf(REACH[spec.piece], r, aspect);
  return { x0: cx - reach.x, y0: cy - reach.y, x1: cx + reach.x, y1: cy + reach.y };
}

/**
 * The region a piece may paint in, as fractions of the field: its side's strip from the outer edge to the inner edge
 * (x 0 to 0.28 on the left, 0.72 to 1 on the right), y 0.12 to 0.95: down to the top corners' edge and nearly to the bottom. A boss piece runs down to the bottom edge. Every
 * strip lies outside the centre keep-out and the top corners, so `KEEP_OUT` holds for any painter that stays inside it.
 */
export function paintBandFor(spec: BackdropSpec, boss: boolean): FractionBox {
  const x = spec.side === 'left' ? { x0: 0, x1: INNER_LEFT } : { x0: INNER_RIGHT, x1: 1 };
  return { ...x, y0: BAND_TOP, y1: boss ? 1 : BAND_BOTTOM };
}

/** The painters' colour source: the palette's nebula, accent and sky stops only, never the ship, the hostile or the shot. */
function at<T>(items: readonly T[], i: number): T {
  return items[i % items.length] as T;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

const capped = (alpha: number): number => Math.min(alpha, PIECE_ALPHA_MAX);

/** A solid round fill. */
function fillDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, alpha: number): void {
  ctx.fillStyle = rgba(colour, capped(alpha));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** A soft round glow: a radial gradient from `colour` at `alpha` to clear, over the square of `radius` around (x, y). */
function glowBlob(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colour: string, alpha: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, rgba(colour, capped(alpha)));
  glow.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** A stroked ellipse centred on (cx, cy), turned `tilt` radians. */
function strokeRing(ctx: CanvasRenderingContext2D, s: PieceShape, rx: number, ry: number, tilt: number, width: number, colour: string, alpha: number): void {
  ctx.save();
  ctx.translate(s.cx, s.cy);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.strokeStyle = rgba(colour, capped(alpha));
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

/** One painter: draws a piece into `shape` (field units) from the palette and the piece's own stream. */
type Painter = (ctx: CanvasRenderingContext2D, shape: PieceShape, palette: Palette, rng: Rng, boss: boolean) => void;

/**
 * How far each piece's paint lands from its centre, in units of r, on either axis: the farthest circle's centre plus its
 * radius (strokes add their half-width). `pieceFit` sizes r so this box fits the band. The painter tests hold every entry at
 * or above what its painter's shapes measure, so a painter that grows past its entry fails the suite.
 */
export const REACH: Record<PieceId, number> = {
  none: 0,
  ringedPlanet: 2,
  gasGiant: 1.85,
  moon: 1,
  farSun: 2.35,
  spiralSmudge: 1.25,
  station: 1,
  dustLane: 2.2,
  cometTail: 2.9,
  eclipse: 2.2,
};

const PIECES: Record<PieceId, Painter> = {
  none: () => undefined,

  ringedPlanet(ctx, s, p, rng) {
    fillDisc(ctx, s.cx, s.cy, s.r, at(p.nebula, 0).color, 0.4);
    glowBlob(ctx, s.cx - s.r * 0.3, s.cy - s.r * 0.3, s.r * 1.2, at(p.accent, 0), 0.35);
    strokeRing(ctx, s, s.r * 1.9, s.r * 0.5, rng.range(-0.5, -0.2), s.r * 0.12, at(p.accent, 1), 0.4);
  },

  gasGiant(ctx, s, p, rng) {
    const bands = 6;
    const step = (s.r * 2) / bands;
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, s.r, 0, TAU);
    ctx.clip();
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = rgba(at(p.nebula, i).color, capped(0.2 + rng.range(0, 0.2)));
      ctx.fillRect(s.cx - s.r, s.cy - s.r + i * step, s.r * 2, step * rng.range(0.4, 0.9));
    }
    glowBlob(ctx, s.cx + s.r * 0.45, s.cy + s.r * 0.45, s.r * 1.4, p.skyStops[0], 0.55);
    ctx.restore();
  },

  moon(ctx, s, p, rng) {
    fillDisc(ctx, s.cx, s.cy, s.r, at(p.accent, 0), 0.35);
    const craters = rng.int(4, 8);
    for (let i = 0; i < craters; i++) {
      const angle = rng.range(0, TAU);
      const dist = rng.range(0, 0.7) * s.r;
      fillDisc(ctx, s.cx + Math.cos(angle) * dist, s.cy + Math.sin(angle) * dist, s.r * rng.range(0.08, 0.18), p.skyStops[0], 0.3);
    }
  },

  farSun(ctx, s, p, rng) {
    glowBlob(ctx, s.cx, s.cy, s.r * 2.2, at(p.accent, 0), 0.5);
    fillDisc(ctx, s.cx, s.cy, s.r * 0.6, at(p.accent, 1), 0.55);
    const angle = rng.range(0, TAU);
    fillDisc(ctx, s.cx + Math.cos(angle) * s.r * 2.2, s.cy + Math.sin(angle) * s.r * 2.2, s.r * 0.15, at(p.nebula, 2).color, 0.45);
  },

  spiralSmudge(ctx, s, p, rng) {
    const turn = rng.range(0, TAU);
    for (let arm = 0; arm < 2; arm++) {
      for (let k = 0; k < 5; k++) {
        const dist = s.r * (0.2 + 0.16 * k);
        const angle = turn + arm * Math.PI + k * 0.45;
        ctx.save();
        ctx.translate(s.cx + Math.cos(angle) * dist, s.cy + Math.sin(angle) * dist);
        ctx.rotate(angle + Math.PI / 2);
        ctx.scale(1, 0.45);
        glowBlob(ctx, 0, 0, s.r * (0.38 - 0.04 * k), at(p.nebula, arm + 1).color, 0.35 - 0.03 * k);
        ctx.restore();
      }
    }
    glowBlob(ctx, s.cx, s.cy, s.r * 0.35, at(p.accent, 0), 0.45);
  },

  station(ctx, s, p, rng) {
    const dark = p.skyStops[0];
    strokeRing(ctx, s, s.r, s.r * 0.3, 0, s.r * 0.14, dark, 0.55);
    ctx.lineWidth = s.r * 0.05;
    ctx.strokeStyle = rgba(dark, 0.55);
    for (const angle of [0, TAU / 3, (2 * TAU) / 3]) {
      ctx.beginPath();
      ctx.moveTo(s.cx, s.cy);
      ctx.lineTo(s.cx + Math.cos(angle) * s.r, s.cy + Math.sin(angle) * s.r * 0.3);
      ctx.stroke();
    }
    fillDisc(ctx, s.cx, s.cy, s.r * 0.22, dark, 0.55);
    const windows = rng.int(3, 7);
    for (let i = 0; i < windows; i++) {
      const angle = rng.range(0, TAU);
      ctx.fillStyle = rgba(at(p.accent, 0), capped(0.5));
      ctx.fillRect(s.cx + Math.cos(angle) * s.r * 0.9, s.cy + Math.sin(angle) * s.r * 0.27, s.r * 0.04, s.r * 0.04);
    }
  },

  dustLane(ctx, s, p, rng) {
    ctx.save();
    ctx.translate(s.cx, s.cy);
    ctx.rotate(rng.range(-0.6, -0.2));
    ctx.scale(1, 0.25);
    for (let k = 0; k < 7; k++) {
      glowBlob(ctx, (k / 6 - 0.5) * s.r * 3.2, 0, s.r * 0.5, at(p.nebula, 2).color, 0.3);
    }
    for (let i = 0; i < 30; i++) {
      fillDisc(ctx, rng.range(-1.6, 1.6) * s.r, rng.range(-0.5, 0.5) * s.r, s.r * 0.12, at(p.nebula, 3).color, 0.4);
    }
    ctx.restore();
  },

  cometTail(ctx, s, p, rng) {
    const tilt = rng.range(0.5, 0.9);
    ctx.save();
    ctx.translate(s.cx, s.cy);
    ctx.rotate(tilt);
    for (let k = 0; k < 7; k++) {
      const t = k / 6;
      glowBlob(ctx, -s.r * (0.3 + 2.4 * t), s.r * 0.35 * t * t, s.r * (0.45 - 0.05 * k), at(p.accent, 2), 0.4 * (1 - t));
    }
    ctx.restore();
    glowBlob(ctx, s.cx, s.cy, s.r * 0.9, at(p.accent, 2), 0.5);
    fillDisc(ctx, s.cx, s.cy, s.r * 0.18, at(p.accent, 0), 0.55);
  },

  eclipse(ctx, s, p) {
    glowBlob(ctx, s.cx, s.cy, s.r * 2.2, at(p.accent, 1), 0.5);
    glowBlob(ctx, s.cx, s.cy, s.r * 1.3, at(p.accent, 0), 0.45);
    // Stacked passes keep each paint under the alpha cap while the disc still reads as solid dark.
    for (let pass = 0; pass < 3; pass++) fillDisc(ctx, s.cx, s.cy, s.r, p.skyStops[0], 0.55);
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, s.r * 1.02, 0, TAU);
    ctx.strokeStyle = rgba(at(p.accent, 0), capped(0.5));
    ctx.lineWidth = s.r * 0.05;
    ctx.stroke();
  },
};

/**
 * Paints `spec`'s set-piece into the sky: its centre and radius from `pieceFit`, its painter from `PIECES`, all clipped to
 * its paint band as a safety net (`pieceFit` keeps the painted box inside it, so nothing visible is cut). `none` paints
 * nothing. The `rng` is the caller's piece stream, so the same spec always draws the same piece.
 */
export function drawPiece(ctx: CanvasRenderingContext2D, spec: BackdropSpec, palette: Palette, field: Field, rng: Rng): void {
  if (spec.piece === 'none') return;
  const fit = pieceFit(spec, field.width / field.height, spec.boss);
  const shape: PieceShape = { cx: fit.cx * field.width, cy: fit.cy * field.height, r: fit.r * field.height };
  const band = paintBandFor(spec, spec.boss);
  ctx.save();
  ctx.beginPath();
  ctx.rect(band.x0 * field.width, band.y0 * field.height, (band.x1 - band.x0) * field.width, (band.y1 - band.y0) * field.height);
  ctx.clip();
  PIECES[spec.piece](ctx, shape, palette, rng, spec.boss);
  ctx.restore();
}
