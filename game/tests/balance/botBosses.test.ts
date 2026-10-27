import { describe, expect, it } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import type { GalaxyId } from '../../src/content/types';
import { recordRun, replayControls } from '../helpers/botReplay';
import { BOT_RUN_TIMEOUT_MS } from '../helpers/botRuns';

/** A boss must fall within this long of its arrival. */
const LIMIT_SECONDS = 120;
const FIGHT_SECONDS = BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + LIMIT_SECONDS;

// The Monolith's and the Hive Carrier's kill rates, and their lives taken off an idle ship, are pinned over 40 seeds
// with the rest of their galaxies' targets (galaxy-1-6.test.ts, galaxy-2-6.test.ts). The Warden's are in warden.test.ts.
describe.each<{ id: GalaxyId; boss: string }>([
  { id: '1-6', boss: 'the Monolith' },
  { id: '2-6', boss: 'the Hive Carrier' },
])('the expert bot against $boss on $id', { timeout: BOT_RUN_TIMEOUT_MS }, ({ id }) => {
  it('replays a fight exactly, from the same seed and from its own controls', () => {
    const galaxy = galaxyById(id);
    const options = { galaxy, seed: 1, profile: 'expert', maxSeconds: FIGHT_SECONDS } as const;
    const { result, controls, events } = recordRun(options);
    expect(events.some((e) => e.type === 'bossWindup')).toBe(true);
    expect(runGalaxy(options)).toEqual(result);
    const replayed = replayControls(galaxy, 1, controls);
    expect(replayed.events).toEqual(events);
    expect(replayed.score).toBe(result.score);
  });
});
