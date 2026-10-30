import { describe, expect, it } from 'vitest';
import { GALAXIES } from '../../src/content/galaxies';
import { type BackdropSpec, type PieceId, backdropSpecFor } from '../../src/render/backdropSpec';
import { KEEP_OUT, PIECE_ALPHA_MAX, clearsKeepOut, drawPiece, pieceBox } from '../../src/render/backdropPieces';
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

/** A context that logs every call, property set and gradient stop a painter makes, in order. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const gradient = (kind: string, args: unknown[]) => {
    calls.push([kind, ...args]);
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
          return undefined;
        };
      },
      set: (_target, name, value: unknown) => {
        calls.push(['set', String(name), typeof value === 'string' ? value : 'gradient']);
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** What `piece` draws in `palette` on `field`, from the stream a sky gives it. */
function drawnBy(spec: BackdropSpec, palette: Palette, field: Field): Call[] {
  const { ctx, calls } = recordingContext();
  drawPiece(ctx, spec, palette, field, createRng(deriveSeed(spec.seed, 'piece')));
  return calls;
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

  it('runs a boss piece off its outer edge only, and keeps its top below the top corners', () => {
    const left = pieceBox({ seed: 1, piece: 'eclipse', boss: true, side: 'left', slot: 0 }, ASPECTS[0] as number, true);
    expect(left.x1).toBeCloseTo(0.28);
    expect(left.x0).toBeLessThan(0);
    expect(left.y0).toBeGreaterThanOrEqual(0.12);
    const right = pieceBox({ seed: 1, piece: 'eclipse', boss: true, side: 'right', slot: 3 }, ASPECTS[2] as number, true);
    expect(right.x0).toBeCloseTo(0.72);
    expect(right.x1).toBeLessThanOrEqual(1);
  });
});
