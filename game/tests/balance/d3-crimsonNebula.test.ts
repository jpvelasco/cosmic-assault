import { beforeAll, describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { BALANCE_SEEDS, BOT_SEEDS } from '../helpers/botRuns';
import { auditFoeAttacks, auditTelegraphs, type FoeAttackPair, hazardsShown, type PlayedRun, playLogged, type TelegraphPair } from '../helpers/telegraphAudit';

/** Crimson Nebula's survival galaxies, each played on the ten bot seeds (by an idle ship, on the 40 balance seeds). */
const CRIMSON: readonly GalaxyId[] = ['3-1', '3-2', '3-3', '3-4', '3-5'];
/** Fifty whole galaxies a profile take most of a minute on a loaded host. */
const TIMEOUT_MS = 600_000;

/** The zones `id`'s schedule shows. */
const scheduledZones = (id: GalaxyId): number => galaxyById(id).events.flatMap(hazardsShown).filter((type) => type === 'dangerZone').length;

describe('Crimson Nebula, played by the bots', { timeout: TIMEOUT_MS }, () => {
  let expert: PlayedRun[] = [];
  /** The casual and the idle ship, whose runs see the attacks the expert gives no chance: mines arm only by an idle ship. */
  let others: PlayedRun[] = [];
  beforeAll(() => {
    expert = playLogged(CRIMSON, 'expert', BOT_SEEDS);
    // The idle ship over all 40 seeds: on Crimson Nebula's light field it meets an armed mine on only a few.
    others = [...playLogged(CRIMSON, 'casual', BOT_SEEDS), ...playLogged(CRIMSON, 'statue', BALANCE_SEEDS)];
  }, TIMEOUT_MS);

  it('warns of every gunship bolt, mine blast and danger zone for its whole telegraph, 3-1 to 3-5, as the expert and the casual play 10 seeds and an idle ship 40', () => {
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
