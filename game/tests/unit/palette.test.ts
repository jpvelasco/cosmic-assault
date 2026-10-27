import { describe, expect, it } from 'vitest';
import { GALAXIES } from '../../src/content/galaxies';
import type { PaletteId } from '../../src/content/types';
import { hexToRgb } from '../../src/render/color';
import { DRIFT, ION_REACH, PALETTE_IDS, paletteFor, type Palette } from '../../src/render/palette';

const hexFields = (p: Palette): string[] => [
  ...p.skyStops, ...p.rock, ...p.ship, ...p.accent, ...p.nebula.map((n) => n.color),
  p.rockGlow, p.cockpit, p.shot, p.shotCore, p.spark, p.ring, p.hud, p.star,
];

describe('paletteFor', () => {
  it('resolves every palette id to the palette that carries it', () => {
    expect(PALETTE_IDS).toEqual(['drift', 'ionReach']);
    for (const id of PALETTE_IDS) expect(paletteFor(id).id).toBe(id);
    expect(paletteFor('drift')).toBe(DRIFT);
    expect(paletteFor('ionReach')).toBe(ION_REACH);
  });

  it('resolves the palette of every galaxy', () => {
    for (const g of GALAXIES) expect(PALETTE_IDS, g.id).toContain(g.palette);
  });

  it('names the id and the valid ones for a palette that does not exist', () => {
    expect(() => paletteFor('crimson' as PaletteId)).toThrow(/crimson.*drift.*ionReach/);
  });
});

describe('ION_REACH', () => {
  it('uses only valid hex colours and sane nebula fractions', () => {
    for (const hex of hexFields(ION_REACH)) expect(() => hexToRgb(hex)).not.toThrow();
    for (const n of ION_REACH.nebula) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(1);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(1);
      expect(n.r).toBeGreaterThan(0);
    }
  });

  it('keeps the ship green and the shot core white, as the design asks', () => {
    expect(ION_REACH.ship).toEqual(DRIFT.ship);
    expect(ION_REACH.ship[1]).toBe('#39ff14');
    expect(ION_REACH.shotCore).toBe('#ffffff');
  });

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
