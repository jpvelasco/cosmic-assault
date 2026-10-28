import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { PLAYER } from '../../src/sim/config';
import { BALANCE_SEEDS } from '../helpers/botRuns';
import { ringGaps, wardenGaps } from '../helpers/ringGaps';
import { fightSeconds } from './targets';

// The Warden's kill rate and the lives it takes off an idle ship are pinned with the rest of 3-★'s targets
// (d3-targets.test.ts); this file audits its ring's gaps through the expert's fights.

/** Each of the ring's two gaps stays at least this wide at every step. */
const WIDE_GAP = 50;
const GALAXY = galaxyById('3-6');
/** The longest the expert may take to beat it: its approach, its arrival and its bar. */
const FIGHT_SECONDS = fightSeconds('warden');
/** 40 whole boss fights. */
const TIMEOUT_MS = 600_000;

interface Fight {
  readonly seed: number;
  /** The narrower of the two gaps at its narrowest, over every step of the fight. */
  readonly narrowestGap: number;
  /** At the most, how many openings round the ring, a pulse aside, were wide enough for the ship but under a gap's width. */
  readonly halfOpen: number;
}

function fight(seed: number): Fight {
  let narrowestGap = Infinity;
  let halfOpen = 0;
  runGalaxy({
    galaxy: GALAXY,
    seed,
    profile: 'expert',
    maxSeconds: FIGHT_SECONDS,
    onStep: (world) => {
      const boss = world.boss;
      if (boss?.state !== 'fighting') return;
      narrowestGap = Math.min(narrowestGap, wardenGaps(boss)[0]);
      // A pulse sweeps the turrets out through the space round the ring, opening every space between them on the way.
      if (boss.active !== 'ringPulse') halfOpen = Math.max(halfOpen, ringGaps(boss).filter((g) => g >= 2 * PLAYER.radius && g < WIDE_GAP).length);
    },
  });
  return { seed, narrowestGap, halfOpen };
}

describe('the Warden on 3-★, over 40 seeds', { timeout: TIMEOUT_MS }, () => {
  let expert: Fight[] = [];

  beforeAll(() => {
    expert = BALANCE_SEEDS.map((seed) => fight(seed));
  }, TIMEOUT_MS);

  it('keeps both gaps at least 50 wide at every step of every expert fight, and no opening the ship might just squeeze through', () => {
    for (const f of expert) {
      expect(f.narrowestGap, `seed ${String(f.seed)}`).toBeGreaterThanOrEqual(WIDE_GAP);
      expect(f.halfOpen, `seed ${String(f.seed)}`).toBe(0);
    }
  });
});
