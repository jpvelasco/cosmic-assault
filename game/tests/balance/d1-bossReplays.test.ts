import { describe, expect, it } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { recordRun, replayControls } from '../helpers/botReplay';
import { BOT_RUN_TIMEOUT_MS } from '../helpers/botRuns';
import { fightSeconds } from './targets';

// Every boss's kill rate, and the lives it takes off an idle ship, are pinned over 40 seeds with the rest of its
// galaxy's targets (d1-targets.test.ts to d5-targets.test.ts); the later bosses' replays are in their own files.
describe.each<{ id: GalaxyId; boss: string }>([
  { id: '1-6', boss: 'the Monolith' },
  { id: '2-6', boss: 'the Hive Carrier' },
])('the expert bot against $boss on $id', { timeout: BOT_RUN_TIMEOUT_MS }, ({ id }) => {
  it('replays a fight exactly, from the same seed and from its own controls', () => {
    const galaxy = galaxyById(id);
    if (galaxy.boss === null) throw new Error(`${id} has no boss to replay a fight with: list a boss galaxy`);
    const options = { galaxy, seed: 1, profile: 'expert', maxSeconds: fightSeconds(galaxy.boss) } as const;
    const { result, controls, events } = recordRun(options);
    expect(events.some((e) => e.type === 'bossWindup')).toBe(true);
    expect(runGalaxy(options)).toEqual(result);
    const replayed = replayControls(galaxy, 1, controls);
    expect(replayed.events).toEqual(events);
    expect(replayed.score).toBe(result.score);
  });
});
