import { beforeAll, describe, expect, it } from 'vitest';
import { BLACK_HOLE } from '../../src/content/hazards';
import { PLAYER } from '../../src/sim/config';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { BOT_SEEDS } from '../helpers/botRuns';
import { auditFoeAttacks, auditTelegraphs, hazardsShown, type PlayedRun, playLogged, type TelegraphPair } from '../helpers/telegraphAudit';

/** Singularity's survival galaxies, each played on the ten bot seeds. */
const SINGULARITY: readonly GalaxyId[] = ['5-1', '5-2', '5-3', '5-4', '5-5'];
const TIMEOUT_MS = 600_000;

describe('Singularity, played by the bots', { timeout: TIMEOUT_MS }, () => {
  let expert: PlayedRun[] = [];
  let casual: PlayedRun[] = [];
  beforeAll(() => {
    expert = playLogged(SINGULARITY, 'expert', BOT_SEEDS);
    casual = playLogged(SINGULARITY, 'casual', BOT_SEEDS);
  }, TIMEOUT_MS);

  it('meets the black hole and every other hazard its schedule shows on every cleared run, with its telegraph whole', () => {
    for (const { id, seed, result, log } of [...expert, ...casual]) {
      if (!result.cleared) continue;
      const expected = galaxyById(id).events.flatMap(hazardsShown).length;
      const pairs: TelegraphPair[] = auditTelegraphs(log);
      expect(pairs.length, `${id} seed ${String(seed)}`).toBe(expected);
      expect(pairs.filter((p) => p.kind === 'blackHole').length, `${id} seed ${String(seed)}`).toBe(1);
    }
  });

  it('warns of every black hole for its whole telegraph, and sees its pull and its swallowing at work, as the expert and the casual play', () => {
    const seen = new Map<string, number>();
    for (const { log } of [...expert, ...casual]) {
      auditFoeAttacks(log);
      for (const { event } of log) {
        const count = seen.get(event.type) ?? 0;
        seen.set(event.type, count + 1);
      }
    }
    expect(seen.get('holeWarning') ?? 0).toBeGreaterThan(0);
    expect(seen.get('holeStart') ?? 0).toBeGreaterThan(0);
    expect(seen.get('holeEnd') ?? 0).toBeGreaterThan(0);
    expect(seen.get('asteroidLeft') ?? 0).toBeGreaterThan(0);
  });

  it('never costs the expert a life to the horizon: no ship is hit within the horizon\'s contact radius', () => {
    const contact = BLACK_HOLE.horizon + PLAYER.radius;
    for (const { id, seed, log, field } of expert) {
      for (const { event } of log) {
        if (event.type !== 'shipHit') continue;
        expect(Math.hypot(event.x - field.width / 2, event.y - field.height / 2), `${id} seed ${String(seed)}`).toBeGreaterThanOrEqual(contact);
      }
    }
  });
});
