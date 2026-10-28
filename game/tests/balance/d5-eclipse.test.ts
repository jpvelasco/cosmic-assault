import { describe, expect, it } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { recordRun, replayControls } from '../helpers/botReplay';

// The Eclipse's kill rate and the lives it takes off an idle ship are pinned with the rest of 5-★'s targets
// (d5-targets.test.ts).
const GALAXY = galaxyById('5-6');
/** The longest the expert may take to beat it (its bar in targets.ts), after its approach and arrival. */
const FIGHT_SECONDS = BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + 240;
/** One whole fight, twice over, on a loaded host. */
const TIMEOUT_MS = 120_000;

describe('the Eclipse on 5-★', () => {
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
