import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { PLAYER } from '../../src/sim/config';
import { BALANCE_SEEDS } from '../helpers/botRuns';
import { ringGaps, wardenGaps } from '../helpers/ringGaps';

/** The expert beats each boss within this long of its arrival (the balance targets); the Task 7 brief allows 150 s. */
const KILL_SECONDS = 120;
const BRIEF_KILL_SECONDS = 150;
/** Each of the ring's two gaps stays at least this wide at every step (RF 4). */
const WIDE_GAP = 50;
const GALAXY = galaxyById('3-6');
const FIGHT_SECONDS = BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + BRIEF_KILL_SECONDS;
/** 40 whole boss fights a bot. */
const TIMEOUT_MS = 600_000;

interface Fight {
  readonly seed: number;
  readonly result: RunResult;
  /** Lives lost after the Warden arrived. */
  readonly lostToBoss: number;
  /** The narrower of the two gaps at its narrowest, over every step of the fight. */
  readonly narrowestGap: number;
  /** At the most, how many openings round the ring, a pulse aside, were wide enough for the ship but under a gap's width. */
  readonly halfOpen: number;
}

function fight(seed: number, profile: BotProfile): Fight {
  let arrived = false;
  let lostToBoss = 0;
  let narrowestGap = Infinity;
  let halfOpen = 0;
  const result = runGalaxy({
    galaxy: GALAXY,
    seed,
    profile,
    maxSeconds: FIGHT_SECONDS,
    onStep: (world, _controls, events) => {
      for (const event of events) {
        if (event.type === 'bossIntro') arrived = true;
        else if (event.type === 'shipHit' && arrived) lostToBoss++;
      }
      const boss = world.boss;
      if (boss?.state !== 'fighting') return;
      narrowestGap = Math.min(narrowestGap, wardenGaps(boss)[0]);
      // A pulse sweeps the turrets out through the space round the ring, opening every space between them on the way.
      if (boss.active !== 'ringPulse') halfOpen = Math.max(halfOpen, ringGaps(boss).filter((g) => g >= 2 * PLAYER.radius && g < WIDE_GAP).length);
    },
  });
  return { seed, result, lostToBoss, narrowestGap, halfOpen };
}

const killedWithin = (fights: readonly Fight[], seconds: number): Fight[] => fights.filter((f) => f.result.cleared && (f.result.bossKillTime ?? Infinity) <= seconds);
const summary = (fights: readonly Fight[]): string =>
  fights.map((f) => `seed ${String(f.seed)}: ${f.result.cleared ? `killed in ${(f.result.bossKillTime ?? 0).toFixed(1)} s` : 'not killed'}, ${String(f.lostToBoss)} lives lost`).join('\n');

describe('the Warden on 3-★, over 40 seeds', { timeout: TIMEOUT_MS }, () => {
  let expert: Fight[] = [];
  let statue: Fight[] = [];

  beforeAll(() => {
    expert = BALANCE_SEEDS.map((seed) => fight(seed, 'expert'));
    statue = BALANCE_SEEDS.map((seed) => fight(seed, 'statue'));
  }, TIMEOUT_MS);

  it('keeps both gaps at least 50 wide at every step of every expert fight, and no opening the ship might just squeeze through (RF 4)', () => {
    for (const f of expert) {
      expect(f.narrowestGap, `seed ${String(f.seed)}`).toBeGreaterThanOrEqual(WIDE_GAP);
      expect(f.halfOpen, `seed ${String(f.seed)}`).toBe(0);
    }
  });

  it('is killed by the expert within 120 s of its arrival on all 40 seeds', () => {
    const killed = killedWithin(expert, KILL_SECONDS);
    console.info(`Warden: expert kills within ${String(KILL_SECONDS)} s on ${String(killed.length)}/40, within ${String(BRIEF_KILL_SECONDS)} s on ${String(killedWithin(expert, BRIEF_KILL_SECONDS).length)}/40\n${summary(expert)}`);
    expect(killed.length, summary(expert)).toBe(BALANCE_SEEDS.length);
  });

  it('takes at least one life off a ship that never moves or fires, on all 40 seeds', () => {
    for (const f of statue) expect(f.lostToBoss, `seed ${String(f.seed)}`).toBeGreaterThanOrEqual(1);
  });
});
