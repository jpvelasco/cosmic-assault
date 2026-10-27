import { describe, expect, it } from 'vitest';
import { GALAXIES } from '../../src/content/galaxies';
import type { PaletteId } from '../../src/content/types';
import { hexToRgb } from '../../src/render/color';
import { CRIMSON_NEBULA, DRIFT, ION_REACH, PALETTE_IDS, paletteFor, SINGULARITY, VOID_RIFT, type Palette } from '../../src/render/palette';

const hexFields = (p: Palette): string[] => [
  ...p.skyStops, ...p.rock, ...p.ship, ...p.accent, ...p.nebula.map((n) => n.color),
  p.rockGlow, p.cockpit, p.shot, p.shotCore, p.spark, p.ring, p.hud, p.star,
];

describe('paletteFor', () => {
  it('resolves every palette id to the palette that carries it', () => {
    expect(PALETTE_IDS).toEqual(['drift', 'ionReach', 'crimsonNebula', 'voidRift', 'singularity']);
    for (const id of PALETTE_IDS) expect(paletteFor(id).id).toBe(id);
    expect(paletteFor('drift')).toBe(DRIFT);
    expect(paletteFor('ionReach')).toBe(ION_REACH);
    expect(paletteFor('crimsonNebula')).toBe(CRIMSON_NEBULA);
    expect(paletteFor('voidRift')).toBe(VOID_RIFT);
    expect(paletteFor('singularity')).toBe(SINGULARITY);
  });

  it('resolves the palette of every galaxy', () => {
    for (const g of GALAXIES) expect(PALETTE_IDS, g.id).toContain(g.palette);
  });

  it('names the id and the valid ones for a palette that does not exist', () => {
    expect(() => paletteFor('crimson' as PaletteId)).toThrow(/crimson.*drift.*ionReach.*singularity/);
  });
});

describe('ION_REACH', () => {
  it('differs from the Drift in its sky, nebula, rocks and accents', () => {
    expect(ION_REACH.skyStops).not.toEqual(DRIFT.skyStops);
    expect(ION_REACH.nebula).not.toEqual(DRIFT.nebula);
    expect(ION_REACH.rock).not.toEqual(DRIFT.rock);
    expect(ION_REACH.accent).not.toEqual(DRIFT.accent);
  });

  it('has a sky that reads as cyan: its blue and green channels outweigh red at every stop', () => {
    for (const stop of ION_REACH.skyStops) {
      const [r, g, b] = hexToRgb(stop);
      expect(g + b).toBeGreaterThan(r * 3);
    }
  });
});

const ALL = PALETTE_IDS.map(paletteFor);

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe.each(ALL)('palette $id', (palette) => {
  it('uses only valid hex colours and sane nebula fractions', () => {
    for (const hex of hexFields(palette)) expect(() => hexToRgb(hex)).not.toThrow();
    for (const n of palette.nebula) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(1);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(1);
      expect(n.r).toBeGreaterThan(0);
      expect(n.alpha).toBeGreaterThan(0);
      expect(n.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the ship green and every shot\'s core white', () => {
    expect(palette.ship[1]).toBe('#39ff14');
    expect(palette.shotCore).toBe('#ffffff');
  });

  it.each(['shot', 'hostile (accent[0])', 'rock lit side'])('keeps the %s at 3:1 or better against every sky stop', (name) => {
    const color = { shot: palette.shot, 'hostile (accent[0])': palette.accent[0], 'rock lit side': palette.rock[0] }[name] as string;
    for (const stop of palette.skyStops) expect(contrast(color, stop), `${name} on ${stop}`).toBeGreaterThanOrEqual(3);
  });
});

describe('the five palettes', () => {
  it('differ from each other in sky, nebula, rocks, shot and accents', () => {
    for (const field of ['skyStops', 'nebula', 'rock', 'shot', 'accent'] as const) {
      const seen = ALL.map((p) => JSON.stringify(p[field]));
      expect(new Set(seen).size, field).toBe(ALL.length);
    }
  });

  it('lead with the colours the design asks for', () => {
    expect(CRIMSON_NEBULA.skyStops).toEqual(['#2b0610', '#4a0d1c', '#1c0a14']);
    expect(CRIMSON_NEBULA.shot).toBe('#5cf2ff');
    expect(CRIMSON_NEBULA.accent[0]).toBe('#ffe14f');
    expect(VOID_RIFT.skyStops).toEqual(['#12052e', '#25094d', '#0a0420']);
    expect(VOID_RIFT.shot).toBe('#ffd36b');
    expect(VOID_RIFT.accent[0]).toBe('#ff4f7a');
    expect(SINGULARITY.skyStops).toEqual(['#0a0804', '#1a1408', '#050403']);
    expect(SINGULARITY.shot).toBe('#4fd8ff');
    expect(SINGULARITY.accent[0]).toBe('#ff3d6e');
  });
});
