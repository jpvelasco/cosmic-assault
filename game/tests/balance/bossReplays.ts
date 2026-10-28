import { describe, expect, it } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { recordRun, replayControls } from '../helpers/botReplay';
import { fightSeconds } from './targets';

/** One whole fight, twice over, on a loaded host. */
const TIMEOUT_MS = 120_000;

/**
 * Pins that the expert's fight against each boss galaxy's boss replays exactly, from the same seed and from its own
 * controls, within the longest the expert may take to beat it (`fightSeconds`). A boss's kill rates and the lives it
 * takes off an idle ship are pinned over 40 seeds with the rest of its galaxy's targets (d<N>-targets.test.ts).
 */
export function describeBossReplays(bosses: readonly { readonly id: GalaxyId; readonly boss: string }[]): void {
  describe.each(bosses)('the expert bot against $boss on $id', { timeout: TIMEOUT_MS }, ({ id }) => {
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
}
