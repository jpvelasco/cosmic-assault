import { describe, expect, it } from 'vitest';
import { GALAXIES } from '../../src/content/galaxies';
import { type BackdropSpec, PIECE_SLOTS, type PieceId, backdropSpecFor } from '../../src/render/backdropSpec';
import { type FractionBox, KEEP_OUT, PIECE_ALPHA_MAX, REACH, clearsKeepOut, drawPiece, paintBandFor, pieceBox, pieceFit } from '../../src/render/backdropPieces';
import { hexToRgb } from '../../src/render/color';
import { PALETTE_IDS, paletteFor, type Palette } from '../../src/render/palette';
import type { Field } from '../../src/sim/field';
import { createRng, deriveSeed } from '../../src/sim/rng';

/** The three field aspects a sky is drawn at: 4:3, 16:9 and 21:9, all with the 720-unit height. */
const FIELDS: readonly Field[] = [
  { width: 960, height: 720 },
  { width: 1280, height: 720 },
  { width: 1680, height: 720 },
];
const ASPECTS = FIELDS.map((field) => field.width / field.height);
const PIECES: readonly PieceId[] = ['ringedPlanet', 'gasGiant', 'moon', 'farSun', 'spiralSmudge', 'station', 'dustLane', 'cometTail', 'eclipse'];
const RGBA = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/;

type Call = unknown[];

/** A 2D affine matrix as `setTransform` takes it: a, b, c, d, e, f. */
type Mat = readonly [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
/** Where a circle or ellipse lands in field units: its centre and its half-extent on each axis, after the transform. */
interface Shape {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
}

/** `m` then `n`, as the canvas composes a transform with the next op. */
function times(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** The transform each state op adds to the current matrix. */
const OPS: Record<string, (a: readonly number[]) => Mat> = {
  translate: ([x = 0, y = 0]) => [1, 0, 0, 1, x, y],
  rotate: ([t = 0]) => [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0],
  scale: ([sx = 1, sy = 1]) => [sx, 0, 0, sy, 0, 0],
};

/**
 * A context that logs every call, property set and gradient stop a painter makes, in order, and records each round shape
 * (arc, ellipse, radial gradient) with the transform in force, so a test can see where it lands.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[]; shapes: Shape[] } {
  const calls: Call[] = [];
  const shapes: Shape[] = [];
  const saved: Mat[] = [];
  let matrix: Mat = IDENTITY;
  const round = (x: number, y: number, rx: number, ry: number): void => {
    const [a, b, c, d, e, f] = matrix;
    shapes.push({ cx: a * x + c * y + e, cy: b * x + d * y + f, hx: Math.hypot(a * rx, c * ry), hy: Math.hypot(b * rx, d * ry) });
  };
  const gradient = (kind: string, args: unknown[]) => {
    calls.push([kind, ...args]);
    if (kind === 'createRadialGradient') round(Number(args[3]), Number(args[4]), Number(args[5]), Number(args[5]));
    return {
      addColorStop: (at: number, colour: string) => {
        calls.push(['stop', at, colour]);
      },
    };
  };
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'createLinearGradient' || name === 'createRadialGradient') {
          return (...args: unknown[]) => gradient(name, args);
        }
        return (...args: unknown[]) => {
          calls.push([String(name), ...args]);
          const nums = args as number[];
          const op = OPS[String(name)];
          if (op !== undefined) matrix = times(matrix, op(nums));
          else if (name === 'save') saved.push(matrix);
          else if (name === 'restore') matrix = saved.pop() ?? IDENTITY;
          else if (name === 'setTransform') matrix = nums as unknown as Mat;
          else if (name === 'arc') round(nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[2] ?? 0);
          else if (name === 'ellipse') round(nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0);
          return undefined;
        };
      },
      set: (_target, name, value: unknown) => {
        calls.push(['set', String(name), typeof value === 'string' ? value : 'gradient']);
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, shapes };
}

/** What `piece` draws in `palette` on `field`, from the stream a sky gives it, and the round shapes it lands. */
function paintedBy(spec: BackdropSpec, palette: Palette, field: Field): { calls: Call[]; shapes: Shape[] } {
  const { ctx, calls, shapes } = recordingContext();
  drawPiece(ctx, spec, palette, field, createRng(deriveSeed(spec.seed, 'piece')));
  return { calls, shapes };
}

/** What `piece` draws in `palette` on `field`, from the stream a sky gives it. */
function drawnBy(spec: BackdropSpec, palette: Palette, field: Field): Call[] {
  return paintedBy(spec, palette, field).calls;
}

const specFor = (piece: PieceId, boss: boolean, seed = 7): BackdropSpec => ({ seed, piece, boss, side: 'right', slot: 1 });

/** Every colour string a call log paints with: fills, strokes and gradient stops. */
function coloursOf(calls: Call[]): string[] {
  return calls.flatMap((call) => {
    if (call[0] === 'stop') return [String(call[2])];
    if (call[0] === 'set' && (call[1] === 'fillStyle' || call[1] === 'strokeStyle') && call[2] !== 'gradient') return [String(call[2])];
    return [];
  });
}

/** The `r,g,b` of every colour a palette owns: its nebula, accents and sky stops. */
function ownTriplets(palette: Palette): Set<string> {
  const colours = [...palette.nebula.map((glow) => glow.color), ...palette.accent, ...palette.skyStops];
  return new Set(colours.map((colour) => hexToRgb(colour).join(',')));
}

describe('set-piece painters', () => {
  it('draws something without throwing for every piece, boss and non-boss, in every field aspect', () => {
    for (const palette of PALETTE_IDS.map(paletteFor)) {
      for (const piece of PIECES) {
        for (const boss of [false, true]) {
          for (const field of FIELDS) {
            expect(drawnBy(specFor(piece, boss), palette, field).length, `${piece} boss=${String(boss)} ${palette.id}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('paints no colour or alpha above PIECE_ALPHA_MAX', () => {
    for (const palette of PALETTE_IDS.map(paletteFor)) {
      for (const piece of PIECES) {
        for (const boss of [false, true]) {
          for (const field of FIELDS) {
            const calls = drawnBy(specFor(piece, boss), palette, field);
            for (const colour of coloursOf(calls)) {
              const match = RGBA.exec(colour);
              expect(match, `${piece} paints ${colour}`).not.toBeNull();
              expect(Number(match?.[4]), `${piece} alpha in ${colour}`).toBeLessThanOrEqual(PIECE_ALPHA_MAX);
            }
            for (const call of calls) {
              if (call[0] === 'set' && call[1] === 'globalAlpha') expect(call[2] as number).toBeLessThanOrEqual(PIECE_ALPHA_MAX);
            }
          }
        }
      }
    }
  });

  it('colours every piece only from its palette: nebula, accents and sky stops, never the ship, hostile or shot', () => {
    for (const id of PALETTE_IDS) {
      const palette = paletteFor(id);
      const own = ownTriplets(palette);
      for (const piece of PIECES) {
        for (const colour of coloursOf(drawnBy(specFor(piece, piece === 'eclipse'), palette, FIELDS[1] as Field))) {
          const rgb = RGBA.exec(colour);
          expect(rgb, colour).not.toBeNull();
          const triplet = (rgb ?? []).slice(1, 4).join(',');
          expect(own.has(triplet), `${piece} in ${id} paints ${colour}`).toBe(true);
        }
      }
    }
  });

  it('draws nothing for the none piece', () => {
    for (const field of FIELDS) {
      expect(drawnBy(specFor('none', false), paletteFor('drift'), field)).toEqual([]);
    }
  });

  it('draws the same calls for the same spec, and different calls for a different seed (except the rng-free eclipse)', () => {
    const palette = paletteFor('ionReach');
    const field = FIELDS[1] as Field;
    for (const piece of PIECES) {
      const spec = specFor(piece, false);
      expect(drawnBy(spec, palette, field), piece).toEqual(drawnBy({ ...spec }, palette, field));
      if (piece !== 'eclipse') expect(drawnBy(specFor(piece, false, 8), palette, field), piece).not.toEqual(drawnBy(spec, palette, field));
    }
  });
});

describe('piece placement', () => {
  it('keeps every galaxy\'s box clear of the keep-out zones at 4:3, 16:9 and 21:9', () => {
    for (const galaxy of GALAXIES) {
      const spec = backdropSpecFor(galaxy, null);
      for (const aspect of ASPECTS) {
        expect(clearsKeepOut(pieceBox(spec, aspect, spec.boss)), `${galaxy.id} at aspect ${aspect.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('rejects a box in the centre ellipse or a top corner, so the check can fail', () => {
    expect(clearsKeepOut({ x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 })).toBe(false);
    expect(clearsKeepOut({ x0: 0.05, y0: 0.02, x1: 0.2, y1: 0.2 })).toBe(false);
    expect(KEEP_OUT.length).toBeGreaterThan(0);
  });

  it('places a small piece in its side band, centred on its row', () => {
    const box = pieceBox({ seed: 1, piece: 'moon', boss: false, side: 'left', slot: 0 }, ASPECTS[1] as number, false);
    expect(box.x0).toBeGreaterThanOrEqual(0.06);
    expect(box.x1).toBeLessThanOrEqual(0.28);
    expect((box.y0 + box.y1) / 2).toBeCloseTo(0.2 + 0.5 * ((0.85 - 0.2) / 4));
  });

  it('anchors a boss piece\'s painted inner edge to its band and lets its outer side run off the field, with its top below the top corners', () => {
    const left = pieceBox({ seed: 1, piece: 'eclipse', boss: true, side: 'left', slot: 0 }, ASPECTS[0] as number, true);
    expect(left.x1).toBeCloseTo(0.28);
    expect(left.x0).toBeLessThan(0);
    expect(left.y0).toBeGreaterThanOrEqual(0.12 - EPS);
    const right = pieceBox({ seed: 1, piece: 'eclipse', boss: true, side: 'right', slot: 3 }, ASPECTS[2] as number, true);
    expect(right.x0).toBeCloseTo(0.72);
    expect(right.x1).toBeGreaterThan(1);
  });
});

/** A rectangle in field units, as `ctx.rect` takes it. */
type Rect = readonly [number, number, number, number];

/** The field-unit rectangle a fraction box covers. */
function fieldRect(box: FractionBox, field: Field): Rect {
  return [box.x0 * field.width, box.y0 * field.height, (box.x1 - box.x0) * field.width, (box.y1 - box.y0) * field.height];
}

const EPS = 1e-9;

/** Whether `box` lies inside `band`, with a tolerance for the float error of computed edges. */
function within(box: FractionBox, band: FractionBox): boolean {
  return box.x0 >= band.x0 - EPS && box.x1 <= band.x1 + EPS && box.y0 >= band.y0 - EPS && box.y1 <= band.y1 + EPS;
}

/** Whether the point (x, y), in fractions of the field, lies inside `band`. */
function containsPoint(band: FractionBox, x: number, y: number): boolean {
  return x >= band.x0 - EPS && x <= band.x1 + EPS && y >= band.y0 - EPS && y <= band.y1 + EPS;
}

/** The fraction box of a recorded `arc` call's circle (the centre and radius, as the painter passed them). */
function arcBox(call: Call, field: Field): FractionBox {
  const [, x, y, r] = call as [string, number, number, number];
  return { x0: (x - r) / field.width, y0: (y - r) / field.height, x1: (x + r) / field.width, y1: (y + r) / field.height };
}

describe('set-piece clipping', () => {
  it('bands each side: outer edge to the centre keep-out, y 0.12 to 0.95, boss pieces to the bottom edge', () => {
    const left = { ...specFor('moon', false), side: 'left' as const };
    expect(paintBandFor(left, false)).toEqual({ x0: 0, y0: 0.12, x1: 0.28, y1: 0.95 });
    expect(paintBandFor(left, true)).toEqual({ x0: 0, y0: 0.12, x1: 0.28, y1: 1 });
    expect(paintBandFor(specFor('moon', false), false)).toEqual({ x0: 0.72, y0: 0.12, x1: 1, y1: 0.95 });
  });

  it('clips each piece to its band once, before it paints, inside one save and restore', () => {
    const palette = paletteFor('ionReach');
    for (const field of FIELDS) {
      for (const galaxy of GALAXIES) {
        const spec = backdropSpecFor(galaxy, null);
        const calls = drawnBy(spec, palette, field);
        const band = fieldRect(paintBandFor(spec, spec.boss), field);
        expect(calls.slice(0, 2), galaxy.id).toEqual([['save'], ['beginPath']]);
        const rect = calls[2] as Call;
        expect(rect[0], galaxy.id).toBe('rect');
        expect(rect.slice(1), galaxy.id).toEqual(band);
        expect(calls[3], galaxy.id).toEqual(['clip']);
        expect(calls.at(-1), galaxy.id).toEqual(['restore']);
      }
    }
  });

  it('keeps every band clear of the keep-out, and every small piece centre inside its band, at 4:3, 16:9 and 21:9', () => {
    for (const galaxy of GALAXIES) {
      const spec = backdropSpecFor(galaxy, null);
      const band = paintBandFor(spec, spec.boss);
      expect(clearsKeepOut(band), `${galaxy.id} band`).toBe(true);
      if (spec.boss) continue;
      for (const aspect of ASPECTS) {
        const box = pieceBox(spec, aspect, false);
        expect(containsPoint(band, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2), `${galaxy.id} at aspect ${aspect.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('flags a drawn circle that lies outside its band, and passes one inside it', () => {
    const field = FIELDS[1] as Field;
    const spec = specFor('moon', false);
    const band = paintBandFor(spec, false);
    const { ctx, calls } = recordingContext();
    ctx.beginPath();
    ctx.arc(field.width / 2, field.height / 2, 20, 0, Math.PI * 2);
    ctx.arc(field.width * 0.9, field.height * 0.5, 20, 0, Math.PI * 2);
    const [centre, inBand] = calls.filter((call) => call[0] === 'arc');
    expect(within(arcBox(centre as Call, field), band)).toBe(false);
    expect(within(arcBox(inBand as Call, field), band)).toBe(true);
  });
});

/** The box a recorded shape covers, as fractions of the field. */
function shapeBox(shape: Shape, field: Field): FractionBox {
  return {
    x0: (shape.cx - shape.hx) / field.width,
    y0: (shape.cy - shape.hy) / field.height,
    x1: (shape.cx + shape.hx) / field.width,
    y1: (shape.cy + shape.hy) / field.height,
  };
}

/** A piece's band with its outer side open for a boss: the field's edge is the only limit there, and the canvas clips it. */
function paintableBand(spec: BackdropSpec): FractionBox {
  const band = paintBandFor(spec, spec.boss);
  if (!spec.boss) return band;
  return spec.side === 'left' ? { ...band, x0: -Infinity } : { ...band, x1: Infinity };
}

describe('painted reach', () => {
  it('lands every painted circle and ellipse inside its band, for every galaxy at 4:3, 16:9 and 21:9', () => {
    const palette = paletteFor('ionReach');
    for (const galaxy of GALAXIES) {
      const spec = backdropSpecFor(galaxy, null);
      for (const field of FIELDS) {
        const band = paintableBand(spec);
        for (const shape of paintedBy(spec, palette, field).shapes) {
          expect(within(shapeBox(shape, field), band), `${galaxy.id} at ${String(field.width)}x${String(field.height)}`).toBe(true);
        }
      }
    }
  });

  it('sets each REACH to at least the farthest any of its painter\'s shapes lands from the piece centre, in units of r', () => {
    const palette = paletteFor('ionReach');
    for (const piece of PIECES) {
      let worst = 0;
      for (const boss of [false, true]) {
        for (const field of FIELDS) {
          const aspect = field.width / field.height;
          for (let seed = 1; seed <= 40; seed++) {
            const side: BackdropSpec['side'] = seed % 2 === 0 ? 'left' : 'right';
            const spec: BackdropSpec = { ...specFor(piece, boss, seed), slot: seed % PIECE_SLOTS, side };
            const fit = pieceFit(spec, aspect, boss);
            const cx = fit.cx * field.width;
            const cy = fit.cy * field.height;
            const unit = fit.r * field.height;
            for (const shape of paintedBy(spec, palette, field).shapes) {
              const reach = Math.max(Math.abs(shape.cx - cx) + shape.hx, Math.abs(shape.cy - cy) + shape.hy) / unit;
              worst = Math.max(worst, reach);
            }
          }
        }
      }
      expect(REACH[piece], piece).toBeGreaterThanOrEqual(worst - EPS);
    }
  });

  it('places every piece\'s painted box inside its band, so the fit holds for every galaxy and aspect', () => {
    for (const galaxy of GALAXIES) {
      const spec = backdropSpecFor(galaxy, null);
      for (const aspect of ASPECTS) {
        expect(within(pieceBox(spec, aspect, spec.boss), paintableBand(spec)), `${galaxy.id} at ${aspect.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('shrinks r to the closed formula when a piece\'s reach would leave its band, and keeps the nominal r when it fits', () => {
    const spec: BackdropSpec = { seed: 1, piece: 'cometTail', boss: false, side: 'left', slot: 0 };
    const band = paintBandFor(spec, false);
    for (const aspect of ASPECTS) {
      const reach = REACH.cometTail;
      const expected = Math.min(0.1, ((band.x1 - band.x0) * aspect) / (2 * reach), (band.y1 - band.y0) / (2 * reach));
      expect(pieceFit(spec, aspect, false).r, `aspect ${aspect.toFixed(2)}`).toBeCloseTo(expected, 12);
    }
    expect(pieceFit(spec, ASPECTS[2] as number, false).r).toBeCloseTo(0.1, 12);
    expect(pieceFit(spec, ASPECTS[0] as number, false).r).toBeLessThan(0.1);
  });
});

/** The contrast and size floor a station or spiral holds: strong enough paint, and a painted radius that reads on dark skies. */
const RIDER: readonly PieceId[] = ['station', 'spiralSmudge'];
const RIDER_MIN_ALPHA = 0.4;
const RIDER_MIN_PAINTED_RADIUS = 0.13;

describe('stations and spirals on dark skies', () => {
  it('paints each with some strong alpha, never in the dark sky stop, and at a painted radius that reads', () => {
    for (const id of PALETTE_IDS) {
      const palette = paletteFor(id);
      const dark = hexToRgb(palette.skyStops[0]).join(',');
      for (const piece of RIDER) {
        for (const field of FIELDS) {
          const spec = specFor(piece, false);
          const coloured = coloursOf(drawnBy(spec, palette, field)).map((colour) => {
            const match = RGBA.exec(colour);
            return { triplet: (match ?? []).slice(1, 4).join(','), alpha: Number(match?.[4]) };
          });
          const strong = coloured.filter((paint) => paint.alpha >= RIDER_MIN_ALPHA);
          expect(strong.length, `${piece} in ${id} at ${String(field.width)}`).toBeGreaterThan(0);
          expect(strong.filter((paint) => paint.triplet === dark), `${piece} in ${id} paints dark strongly`).toEqual([]);
          const fit = pieceFit(spec, field.width / field.height, false);
          expect(fit.r * REACH[piece], `${piece} painted radius`).toBeGreaterThanOrEqual(RIDER_MIN_PAINTED_RADIUS - EPS);
        }
      }
    }
  });
});
