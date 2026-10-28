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
  /** The field's centre, where the black hole sits. */
  readonly centre: { readonly x: number; readonly y: number };
}

function play(profile: BotProfile): Played[] {
  return SINGULARITY.flatMap((id) =>
    BOT_SEEDS.map((seed) => {
      const log: TimedEvent[] = [];
      let centre = { x: 0, y: 0 };
      const result = runGalaxy({
        galaxy: galaxyById(id),
        seed,
        profile,
        onStep: (world, _controls, events) => {
          centre = { x: world.field.width / 2, y: world.field.height / 2 };
          for (const event of events) log.push({ elapsed: world.elapsed, event: { ...event } });
        },
      });
      return { id, seed, result, log, centre };
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
    for (const { id, seed, log, centre } of expert) {
      for (const { event } of log) {
        if (event.type !== 'shipHit') continue;
        expect(Math.hypot(event.x - centre.x, event.y - centre.y), `${id} seed ${String(seed)}`).toBeGreaterThanOrEqual(contact);
      }
    }
  });
});
