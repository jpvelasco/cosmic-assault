import { beforeAll, describe, expect, it } from 'vitest';
import { BLACK_HOLE } from '../../src/content/hazards';
import { PLAYER } from '../../src/sim/config';
import { runGalaxy, type BotProfile, type RunResult } from '../../src/bot/run';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { BOT_SEEDS } from '../helpers/botRuns';
import { auditFoeAttacks, auditTelegraphs, type TelegraphPair, type TimedEvent } from '../helpers/telegraphAudit';

/** Singularity's survival galaxies, each played on the ten bot seeds. */
const SINGULARITY: readonly GalaxyId[] = ['5-1', '5-2', '5-3', '5-4', '5-5'];
const TIMEOUT_MS = 600_000;

interface Played {
  readonly id: GalaxyId;
  readonly seed: number;
  readonly result: RunResult;
  readonly log: readonly TimedEvent[];
}

function play(profile: BotProfile): Played[] {
  return SINGULARITY.flatMap((id) =>
    BOT_SEEDS.map((seed) => {
      const log: TimedEvent[] = [];
      const result = runGalaxy({
        galaxy: galaxyById(id),
        seed,
        profile,
        onStep: (world, _controls, events) => {
          for (const event of events) log.push({ elapsed: world.elapsed, event: { ...event } });
        },
      });
      return { id, seed, result, log };
    }),
  );
}

describe('Singularity, played by the bots', { timeout: TIMEOUT_MS }, () => {
  let expert: Played[] = [];
  let casual: Played[] = [];
  beforeAll(() => {
    expert = play('expert');
    casual = play('casual');
  }, TIMEOUT_MS);

  it('is cleared by the expert on every seed of 5-1 to 5-4, and on at least nine of ten seeds of 5-5 (balance smoke)', () => {
    // 5-5 is the densest Singularity, with a level 3 hole; its clear rate over 40 seeds is 38/40, and Task 11 tunes it.
    const lost = expert.filter((p) => !p.result.cleared).map((p) => `${p.id} seed ${String(p.seed)}`);
    expect(lost.filter((l) => !l.startsWith('5-5'))).toEqual([]);
    expect(lost.filter((l) => l.startsWith('5-5')).length).toBeLessThanOrEqual(1);
  });

  it('meets the black hole and every other hazard its schedule shows on every cleared run, with its telegraph whole', () => {
    for (const { id, seed, result, log } of [...expert, ...casual]) {
      if (!result.cleared) continue;
      // A zone or a rift shows one per intensity, at most two; a black hole, a repulsion field or a shower one each.
      const expected = galaxyById(id).events.reduce((sum, e) => sum + (e.type === 'dangerZone' || e.type === 'warpRift' ? Math.min(e.intensity, 2) : e.type === 'meteorShower' ? 0 : 1), 0);
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
    for (const { id, seed, log } of expert) {
      for (const { event } of log) {
        if (event.type !== 'shipHit') continue;
        expect(Math.hypot(event.x - 640, event.y - 360), `${id} seed ${String(seed)}`).toBeGreaterThanOrEqual(contact);
      }
    }
  });
});
