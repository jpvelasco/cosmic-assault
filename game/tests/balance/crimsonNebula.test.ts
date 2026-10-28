import { beforeAll, describe, expect, it } from 'vitest';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { DANGER_ZONE } from '../../src/content/hazards';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { BOT_SEEDS } from '../helpers/botRuns';
import { auditFoeAttacks, auditTelegraphs, type FoeAttackPair, type TelegraphPair, type TimedEvent } from '../helpers/telegraphAudit';

/** Crimson Nebula's survival galaxies, each played on the ten bot seeds. */
const CRIMSON: readonly GalaxyId[] = ['3-1', '3-2', '3-3', '3-4', '3-5'];
/** Fifty whole galaxies a profile take most of a minute on a loaded host. */
const TIMEOUT_MS = 600_000;

interface Played {
  readonly id: GalaxyId;
  readonly seed: number;
  readonly result: RunResult;
  readonly log: readonly TimedEvent[];
}

function play(profile: BotProfile): Played[] {
  return CRIMSON.flatMap((id) =>
    BOT_SEEDS.map((seed) => {
      const log: TimedEvent[] = [];
      const result = runGalaxy({ galaxy: galaxyById(id), seed, profile, onStep: (world, _controls, events) => {
        for (const event of events) log.push({ elapsed: world.elapsed, event: { ...event } });
      } });
      return { id, seed, result, log };
    }),
  );
}

/** The zones `id`'s schedule shows: one per intensity, at most two an event. */
const scheduledZones = (id: GalaxyId): number =>
  galaxyById(id).events.reduce((sum, e) => sum + (e.type === 'dangerZone' ? Math.min(e.intensity, DANGER_ZONE.maxZones) : 0), 0);

describe('Crimson Nebula, played by the bots', { timeout: TIMEOUT_MS }, () => {
  let expert: Played[] = [];
  /** The casual and the idle ship, whose runs see the attacks the expert gives no chance: mines arm only by an idle ship. */
  let others: Played[] = [];
  beforeAll(() => {
    expert = play('expert');
    others = [...play('casual'), ...play('statue')];
  }, TIMEOUT_MS);

  it('is cleared by the expert on every seed of every survival galaxy, 3-1 to 3-5 (balance smoke)', () => {
    const lost = expert.filter((p) => !p.result.cleared).map((p) => `${p.id} seed ${String(p.seed)}`);
    expect(lost).toEqual([]);
  });

  it('warns of every gunship bolt, mine blast and danger zone for its whole telegraph, 3-1 to 3-5 on 10 seeds, as the expert, the casual and an idle ship play', () => {
    const zones: TelegraphPair[] = [];
    const attacks: FoeAttackPair[] = [];
    for (const { id, seed, result, log } of [...expert, ...others]) {
      const pairs = auditTelegraphs(log);
      // A run cleared has met every zone its schedule shows; a lost one, those before it was lost.
      if (result.cleared) expect(pairs.filter((p) => p.kind === 'dangerZone'), `${id} seed ${String(seed)}`).toHaveLength(scheduledZones(id));
      zones.push(...pairs);
      attacks.push(...auditFoeAttacks(log));
    }
    // The audit has something to audit: zones went active, gunships fired and mines blew.
    expect(zones.length).toBeGreaterThan(0);
    expect(attacks.filter((p) => p.kind === 'gunship').length).toBeGreaterThan(0);
    expect(attacks.filter((p) => p.kind === 'mine').length).toBeGreaterThan(0);
  });
});
