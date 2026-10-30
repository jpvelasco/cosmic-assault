import { afterEach, describe, expect, it, vi } from 'vitest';
import { GALAXIES, galaxyById } from '../../src/content/galaxies';
import { type BackdropSpec, backdropSpecFor, LEGACY_SKY_SEED } from '../../src/render/backdropSpec';
import { hexToRgb, rgba } from '../../src/render/color';
import { bakeSky } from '../../src/render/sky';
import { DRIFT, paletteFor, type Palette } from '../../src/render/palette';
import type { Field } from '../../src/sim/field';
import { createRng } from '../../src/sim/rng';

const FIELD: Field = { width: 1280, height: 720 };

/** A gradient as the sky records it: its kind, the numbers it was made with and the stops added to it. */
class Gradient {
  readonly stops: [number, string][] = [];
  constructor(
    readonly kind: 'linear' | 'radial',
    readonly args: readonly number[],
  ) {}
  addColorStop(at: number, color: string): void {
    this.stops.push([at, color]);
  }
}

/** A 2D context that logs what a bake paints, in order, and keeps every gradient it makes. */
class RecordingContext {
  readonly calls: unknown[][] = [];
  readonly gradients: Gradient[] = [];
  fillStyle: string | Gradient = '';
  globalAlpha = 1;

  createLinearGradient(...args: number[]): Gradient {
    return this.gradient('linear', args);
  }

  createRadialGradient(...args: number[]): Gradient {
    return this.gradient('radial', args);
  }

  setTransform(...args: number[]): void {
    this.calls.push(['setTransform', ...args]);
  }

  /** The path and state calls the set-piece painters make; the sky's checks do not inspect them. */
  readonly save = (): void => undefined;
  readonly restore = (): void => undefined;
  readonly translate = (): void => undefined;
  readonly rotate = (): void => undefined;
  readonly scale = (): void => undefined;
  readonly beginPath = (): void => undefined;
  readonly arc = (): void => undefined;
  readonly ellipse = (): void => undefined;
  readonly moveTo = (): void => undefined;
  readonly lineTo = (): void => undefined;
  readonly quadraticCurveTo = (): void => undefined;
  readonly stroke = (): void => undefined;
  readonly fill = (): void => undefined;
  readonly rect = (): void => undefined;
  readonly clip = (): void => undefined;

  fillRect(...args: number[]): void {
    const style = typeof this.fillStyle === 'string' ? this.fillStyle : this.gradients.indexOf(this.fillStyle);
    this.calls.push(['fillRect', style, this.globalAlpha, ...args]);
  }

  private gradient(kind: 'linear' | 'radial', args: readonly number[]): Gradient {
    const made = new Gradient(kind, args);
    this.gradients.push(made);
    this.calls.push([kind, ...args]);
    return made;
  }
}

/** Every gradient a bake makes, and what it paints, for `spec` in `palette`. */
function bake(palette: Palette, spec: BackdropSpec): RecordingContext {
  const ctx = new RecordingContext();
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  bakeSky(FIELD, 1, palette, spec);
  return ctx;
}

/**
 * The sky's own gradient (made first) and the palette's glows (made next, in order). Set pieces are drawn after the glows,
 * so the gradients they make come after these and are left out.
 */
function skyAndGlows(ctx: RecordingContext, palette: Palette): { sky: Gradient; glows: Gradient[] } {
  const [sky, ...rest] = ctx.gradients;
  if (sky === undefined) throw new Error('the sky made no gradient');
  return { sky, glows: rest.slice(0, palette.nebula.length) };
}

/** The sky as it was painted before 2.0.1, copied from that code: the legacy spec must reproduce its calls exactly. */
function skyBefore201(ctx: RecordingContext, palette: Palette, seed: number): void {
  const SKY_POSITIONS = [0, 0.55, 1];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, FIELD.width, FIELD.height);
  palette.skyStops.forEach((color, i) => {
    sky.addColorStop(SKY_POSITIONS[i] as number, color);
  });
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  for (const { x, y, r, color, alpha } of palette.nebula) {
    const cx = x * FIELD.width;
    const cy = y * FIELD.height;
    const radius = r * FIELD.height;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, rgba(color, alpha));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  const rng = createRng(seed);
  ctx.fillStyle = palette.star;
  for (let i = 0; i < 320; i++) {
    ctx.globalAlpha = rng.range(0, 0.3);
    ctx.fillRect(rng.range(0, FIELD.width), rng.range(0, FIELD.height), 1, 1);
  }
  ctx.globalAlpha = 1;
}

/** The sample of specs the variation is checked on: a few galaxies, a boss galaxy and a Daily. */
const BOSS = GALAXIES.find((g) => g.kind === 'boss');
if (BOSS === undefined) throw new Error('no boss galaxy');
const SAMPLE = [
  galaxyById('1-1'),
  galaxyById('1-2'),
  galaxyById('2-3'),
  galaxyById('3-4'),
  BOSS,
].map((galaxy) => ({ galaxy, spec: backdropSpecFor(galaxy, null) }));
const DAILY = { ...galaxyById('2-2'), label: 'Daily' };
const DAILY_SPEC = backdropSpecFor(DAILY, 0x1234abcd);

/** The `r,g,b` of a glow stop's `rgba()` colour string. */
function rgbOf(colour: string): string {
  const match = /^rgba\((\d+),(\d+),(\d+),/.exec(colour);
  if (match === null) throw new Error(`not an rgba() colour: ${colour}`);
  return `${match[1] ?? ''},${match[2] ?? ''},${match[3] ?? ''}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sky variation', () => {
  it('never changes the sky stops, and keeps every glow in its palette colour', () => {
    for (const { galaxy, spec } of [...SAMPLE, { galaxy: DAILY, spec: DAILY_SPEC }]) {
      const palette = paletteFor(galaxy.palette);
      const { sky, glows } = skyAndGlows(bake(palette, spec), palette);
      expect(sky.stops.map(([, color]) => color), galaxy.id).toEqual([...palette.skyStops]);
      expect(glows, galaxy.id).toHaveLength(palette.nebula.length);
      const glowRgbs = palette.nebula.map((glow) => hexToRgb(glow.color).join(','));
      for (const glow of glows) {
        for (const [, color] of glow.stops) expect(glowRgbs, galaxy.id).toContain(rgbOf(color));
      }
    }
  });

  it('keeps every glow centre on the field, inside the clamp', () => {
    for (const { galaxy, spec } of SAMPLE) {
      const { glows } = skyAndGlows(bake(paletteFor(galaxy.palette), spec), paletteFor(galaxy.palette));
      for (const glow of glows) {
        const [cx = Number.NaN, cy = Number.NaN] = glow.args;
        expect(cx / FIELD.width, galaxy.id).toBeGreaterThanOrEqual(0.05);
        expect(cx / FIELD.width, galaxy.id).toBeLessThanOrEqual(0.95);
        expect(cy / FIELD.height, galaxy.id).toBeGreaterThanOrEqual(0.05);
        expect(cy / FIELD.height, galaxy.id).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it('gives two galaxies different glow geometry and a different sky turn', () => {
    const first = SAMPLE[0];
    const second = SAMPLE[1];
    if (first === undefined || second === undefined) throw new Error('sample too small');
    const geometry = ({ galaxy, spec }: (typeof SAMPLE)[number]) => {
      const { sky, glows } = skyAndGlows(bake(paletteFor(galaxy.palette), spec), paletteFor(galaxy.palette));
      return { sky: sky.args, glows: glows.map((glow) => glow.args) };
    };
    const a = geometry(first);
    const b = geometry(second);
    expect(b.glows).not.toEqual(a.glows);
    expect(b.sky).not.toEqual(a.sky);
  });

  it('bakes the same spec to identical geometry and identical draw calls every time', () => {
    const palette = paletteFor(galaxyById('1-1').palette);
    const spec = backdropSpecFor(galaxyById('1-1'), null);
    const again = backdropSpecFor(galaxyById('1-1'), null);
    expect(again).toEqual(spec);
    expect(bake(palette, again).calls).toEqual(bake(palette, spec).calls);
  });

  it('turns the sky gradient off the field diagonal, but never for the legacy sky', () => {
    const { sky: legacy } = skyAndGlows(bake(DRIFT, backdropSpecFor(null, null)), DRIFT);
    expect(legacy.args).toEqual([0, 0, FIELD.width, FIELD.height]);
    const { sky: varied } = skyAndGlows(bake(DRIFT, backdropSpecFor(galaxyById('1-1'), null)), DRIFT);
    expect(varied.args).not.toEqual([0, 0, FIELD.width, FIELD.height]);
  });

  it('reproduces the sky painted before 2.0.1 exactly for the legacy spec, in every palette it was drawn in', () => {
    for (const id of ['drift', 'ionReach', 'crimsonNebula', 'voidRift', 'singularity'] as const) {
      const palette = paletteFor(id);
      const reference = new RecordingContext();
      skyBefore201(reference, palette, LEGACY_SKY_SEED);
      const legacy = backdropSpecFor(null, null);
      expect(legacy.seed, id).toBe(LEGACY_SKY_SEED);
      expect(reference.calls.length, id).toBeGreaterThan(300);
      expect(bake(palette, legacy).calls, id).toEqual(reference.calls);
    }
  });

  it('leaves the legacy sky as it was even when a spec with that seed and no piece is given', () => {
    const reference = new RecordingContext();
    skyBefore201(reference, DRIFT, LEGACY_SKY_SEED);
    const noPiece = { ...backdropSpecFor(galaxyById('1-1'), null), piece: 'none' as const, seed: LEGACY_SKY_SEED };
    expect(bake(DRIFT, noPiece).calls).toEqual(reference.calls);
  });
});
