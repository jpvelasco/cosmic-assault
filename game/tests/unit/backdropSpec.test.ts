import { describe, expect, it } from 'vitest';
import { GALAXIES, galaxyById } from '../../src/content/galaxies';
import type { GalaxyDef } from '../../src/content/types';
import { BOSS_PIECES, backdropSpecFor, LEGACY_SKY_SEED, NON_BOSS_PIECES, PIECE_SLOTS, type BackdropSpec } from '../../src/render/backdropSpec';

const SURVIVAL = GALAXIES.filter((g) => g.kind === 'survival');
const BOSSES = GALAXIES.filter((g) => g.kind === 'boss');
const ANCHOR = galaxyById('1-1');

/** A Daily built the way the Daily generator builds one: an anchor's galaxy spread under the label. */
const daily = (anchor: GalaxyDef): GalaxyDef => ({ ...anchor, label: 'Daily' });

describe('backdropSpecFor', () => {
  it('is deterministic for every galaxy', () => {
    for (const g of GALAXIES) expect(backdropSpecFor(g, null), g.id).toEqual(backdropSpecFor(g, null));
  });

  it('gives all 30 galaxies distinct seeds', () => {
    const seeds = new Set(GALAXIES.map((g) => backdropSpecFor(g, null).seed));
    expect(seeds.size).toBe(GALAXIES.length);
  });

  it('never gives two consecutive non-boss galaxies the same piece', () => {
    let previous: BackdropSpec | null = null;
    for (const g of SURVIVAL) {
      const spec = backdropSpecFor(g, null);
      if (previous !== null) expect(spec.piece, g.id).not.toBe(previous.piece);
      previous = spec;
    }
  });

  it('gives every boss galaxy the signature piece of its Dimension, at boss scale', () => {
    expect(BOSSES).toHaveLength(5);
    for (const g of BOSSES) {
      const spec = backdropSpecFor(g, null);
      expect(spec.boss, g.id).toBe(true);
      expect(spec.piece, g.id).toBe(BOSS_PIECES[g.dimension]);
    }
  });

  it('gives every non-boss galaxy a non-boss piece', () => {
    for (const g of SURVIVAL) {
      const spec = backdropSpecFor(g, null);
      expect(spec.boss, g.id).toBe(false);
      expect(NON_BOSS_PIECES, g.id).toContain(spec.piece);
    }
  });

  it('keeps side and slot in range for every galaxy and Daily', () => {
    const specs = [...GALAXIES.map((g) => backdropSpecFor(g, null)), backdropSpecFor(daily(ANCHOR), 42)];
    for (const spec of specs) {
      expect(['left', 'right']).toContain(spec.side);
      expect(Number.isInteger(spec.slot)).toBe(true);
      expect(spec.slot).toBeGreaterThanOrEqual(0);
      expect(spec.slot).toBeLessThan(PIECE_SLOTS);
    }
  });

  it('gives a Daily the seed it is handed, a non-boss piece and no boss scale', () => {
    const spec = backdropSpecFor(daily(ANCHOR), 0x1234abcd);
    expect(spec.seed).toBe(0x1234abcd);
    expect(spec.boss).toBe(false);
    expect(NON_BOSS_PIECES).toContain(spec.piece);
    expect(backdropSpecFor(daily(galaxyById('1-6')), 7).boss).toBe(false);
  });

  it('gives two Dailies on different dates different seeds', () => {
    const anchor = daily(ANCHOR);
    expect(backdropSpecFor(anchor, 1).seed).not.toBe(backdropSpecFor(anchor, 2).seed);
    expect(backdropSpecFor(anchor, 1)).toEqual(backdropSpecFor(anchor, 1));
  });

  it('gives a Daily without a date seed its own deterministic seed, apart from its anchor', () => {
    const spec = backdropSpecFor(daily(ANCHOR), null);
    expect(spec).toEqual(backdropSpecFor(daily(ANCHOR), null));
    expect(spec.seed).not.toBe(backdropSpecFor(ANCHOR, null).seed);
  });

  it('gives practice rules (no galaxy) the legacy sky', () => {
    expect(LEGACY_SKY_SEED).toBe(2592898775);
    expect(backdropSpecFor(null, null)).toEqual({ seed: LEGACY_SKY_SEED, piece: 'none', boss: false, side: 'left', slot: 0 });
    expect(backdropSpecFor(null, 99)).toEqual(backdropSpecFor(null, null));
  });
});

describe('piece tables', () => {
  it('lists eight distinct non-boss pieces, never eclipse or none', () => {
    expect(NON_BOSS_PIECES).toHaveLength(8);
    expect(new Set(NON_BOSS_PIECES).size).toBe(8);
    expect(NON_BOSS_PIECES).not.toContain('eclipse');
    expect(NON_BOSS_PIECES).not.toContain('none');
  });
});
