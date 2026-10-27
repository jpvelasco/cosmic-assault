import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import type { GalaxyDef } from '../../src/content/types';
import { recordRun, replayControls } from '../helpers/botReplay';
import { BALANCE_SEEDS } from '../helpers/botRuns';
import { MUTED_KINDS } from '../helpers/mute';

const GALAXY = galaxyById('4-6');
/** The expert must beat the Leviathan within this long of its arrival (Task 8's initial target, tuned in Task 11). */
const KILL_SECONDS = 150;
/** Forty runs of each bot take minutes on a loaded host. */
const TIMEOUT_MS = 600_000;

interface Played {
  readonly result: RunResult;
  /** Lives lost after the boss arrived. */
  readonly lostToBoss: number;
}

/** `profile` playing `galaxy` once per balance seed, counting the lives the fight cost it. */
function play(profile: BotProfile, galaxy: GalaxyDef = GALAXY): Played[] {
  return BALANCE_SEEDS.map((seed) => {
    let arrived = false;
    let lostToBoss = 0;
    const result = runGalaxy({
      galaxy,
      seed,
      profile,
      onStep: (_world, _controls, events) => {
        for (const event of events) {
          if (event.type === 'bossIntro') arrived = true;
          else if (event.type === 'shipHit' && arrived) lostToBoss++;
        }
      },
    });
    return { result, lostToBoss };
  });
}

/** The seeds of `runs` where `keep` holds. */
const seedsWhere = (runs: readonly Played[], keep: (run: Played) => boolean): number[] => BALANCE_SEEDS.filter((_, i) => keep(runs[i] as Played));

describe('the Leviathan on 4-★, over the 40 balance seeds', () => {
  let expert: Played[] = [];
  let statue: Played[] = [];

  beforeAll(() => {
    expert = play('expert');
    statue = play('statue', { ...GALAXY, kinds: MUTED_KINDS, events: [] });
  }, TIMEOUT_MS);

  it(`falls to the expert within ${String(KILL_SECONDS)} s of its arrival on every seed`, () => {
    const slow = seedsWhere(expert, ({ result }) => !(result.cleared && (result.bossKillTime ?? Infinity) <= KILL_SECONDS));
    const times = expert.map(({ result }) => (result.bossKillTime ?? Infinity).toFixed(0)).join(', ');
    expect(slow, `kill times: ${times}`).toEqual([]);
  });

  // With the approach's rocks muted: on 2 seeds in 40 an idle ship loses all three lives to them before the boss arrives.
  it('takes at least one life off an idle ship on every seed', () => {
    expect(seedsWhere(statue, ({ lostToBoss }) => lostToBoss === 0)).toEqual([]);
  });

  it('replays a fight exactly, from the same seed and from its own controls', () => {
    const options = { galaxy: GALAXY, seed: 1, profile: 'expert', maxSeconds: BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + KILL_SECONDS } as const;
    const { result, controls, events } = recordRun(options);
    expect(events.some((e) => e.type === 'bossWindup')).toBe(true);
    expect(runGalaxy(options)).toEqual(result);
    const replayed = replayControls(GALAXY, 1, controls);
    expect(replayed.events).toEqual(events);
    expect(replayed.score).toBe(result.score);
  });
});
