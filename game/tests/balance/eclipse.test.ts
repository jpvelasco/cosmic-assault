import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import type { GalaxyDef } from '../../src/content/types';
import { recordRun, replayControls } from '../helpers/botReplay';
import { BALANCE_SEEDS } from '../helpers/botRuns';
import { MUTED_KINDS } from '../helpers/mute';

/** The expert beats the Eclipse within this long of its arrival, on every seed. */
const KILL_SECONDS = 240;
const GALAXY = galaxyById('5-6');
const FIGHT_SECONDS = BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + KILL_SECONDS;
/** 40 whole boss fights a bot. */
const TIMEOUT_MS = 900_000;

interface Fight {
  readonly seed: number;
  readonly result: RunResult;
  /** Lives lost after the Eclipse arrived. */
  readonly lostToBoss: number;
}

function fight(seed: number, profile: BotProfile, galaxy: GalaxyDef = GALAXY): Fight {
  let arrived = false;
  let lostToBoss = 0;
  const result = runGalaxy({
    galaxy,
    seed,
    profile,
    maxSeconds: FIGHT_SECONDS,
    onStep: (_world, _controls, events) => {
      for (const event of events) {
        if (event.type === 'bossIntro') arrived = true;
        else if (event.type === 'shipHit' && arrived) lostToBoss++;
      }
    },
  });
  return { seed, result, lostToBoss };
}

const killedWithin = (fights: readonly Fight[], seconds: number): Fight[] => fights.filter((f) => f.result.cleared && (f.result.bossKillTime ?? Infinity) <= seconds);
const summary = (fights: readonly Fight[]): string =>
  fights.map((f) => `seed ${String(f.seed)}: ${f.result.cleared ? `killed in ${(f.result.bossKillTime ?? 0).toFixed(1)} s` : 'not killed'}, ${String(f.lostToBoss)} lives lost`).join('\n');

describe('the Eclipse on 5-★, over 40 seeds', { timeout: TIMEOUT_MS }, () => {
  let expert: Fight[] = [];
  let statue: Fight[] = [];

  beforeAll(() => {
    expert = BALANCE_SEEDS.map((seed) => fight(seed, 'expert'));
    // The approach's rocks are muted for the idle ship, so the measure is the boss's: on 1 seed in 40 an idle ship loses
    // all three lives to them before the Eclipse arrives.
    statue = BALANCE_SEEDS.map((seed) => fight(seed, 'statue', { ...GALAXY, kinds: MUTED_KINDS, events: [] }));
  }, TIMEOUT_MS);

  it(`is killed by the expert within ${String(KILL_SECONDS)} s of its arrival on all 40 seeds`, () => {
    const killed = killedWithin(expert, KILL_SECONDS);
    console.info(`Eclipse: expert kills within ${String(KILL_SECONDS)} s on ${String(killed.length)}/40\n${summary(expert)}`);
    expect(killed.length, summary(expert)).toBe(BALANCE_SEEDS.length);
  });

  it('takes at least one life off a ship that never moves or fires, on all 40 seeds', () => {
    for (const f of statue) expect(f.lostToBoss, `seed ${String(f.seed)}`).toBeGreaterThanOrEqual(1);
  });
  it('replays a fight exactly, from the same seed and from its own controls', () => {
    const options = { galaxy: GALAXY, seed: 1, profile: 'expert', maxSeconds: FIGHT_SECONDS } as const;
    const { result, controls, events } = recordRun(options);
    expect(events.some((e) => e.type === 'bossWindup')).toBe(true);
    expect(runGalaxy(options)).toEqual(result);
    const replayed = replayControls(GALAXY, 1, controls);
    expect(replayed.events).toEqual(events);
    expect(replayed.score).toBe(result.score);
  }, TIMEOUT_MS);
});
