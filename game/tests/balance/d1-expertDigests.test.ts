import { expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { describeDigests, DIGEST_GALAXIES, DIGEST_SEEDS, digestKey } from '../helpers/eventDigest';

// The slow half of the D1–D2 pins: the expert plays every galaxy to its end. The scripted half is in tests/unit.
describeDigests('expert', (runs) => {
  it('plays every D2 galaxy to its clear, so its late phases, warp and clear report are pinned', () => {
    for (const id of DIGEST_GALAXIES.filter((g) => g.startsWith('2-'))) for (const seed of DIGEST_SEEDS) expect(runs()[digestKey(id, seed)]?.status, digestKey(id, seed)).toBe('cleared');
  });

  it('sees every scheduled well of every galaxy end', () => {
    const wellGalaxies = DIGEST_GALAXIES.filter((id) => galaxyById(id).events.some((e) => e.type === 'gravityWell'));
    expect(wellGalaxies).toEqual(['2-2', '2-3', '2-4', '2-5']);
    for (const id of wellGalaxies) for (const seed of DIGEST_SEEDS) expect(runs()[digestKey(id, seed)]?.types.has('wellEnd'), digestKey(id, seed)).toBe(true);
  });
});
