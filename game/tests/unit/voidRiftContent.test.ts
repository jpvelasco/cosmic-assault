import { describe, expect, it } from 'vitest';
import { runGalaxy } from '../../src/bot/run';
import { kindProbability } from '../../src/content/curves';
import { GALAXIES, galaxyById, tierOf } from '../../src/content/galaxies';
import type { GalaxyEvent, GalaxyId } from '../../src/content/types';
import { THREAT_COST } from '../../src/sim/galaxy/director';
import { auditFoeAttacks, auditTelegraphs, type TimedEvent } from '../helpers/telegraphAudit';

const VOID_RIFT: readonly GalaxyId[] = ['4-1', '4-2', '4-3', '4-4', '4-5'];
const scheduled = (id: GalaxyId): GalaxyEvent[] => galaxyById(id).events.filter((e) => e.type !== 'meteorShower');

describe('Void Rift content', () => {
  it('keeps phasers and armoured rocks out of Dimensions 1 to 3, and brings them in from 4-1 at 0.12 and 0.1', () => {
    for (const g of GALAXIES.filter((x) => x.dimension <= 3)) {
      expect(g.kinds.phaser, g.id).toEqual({ from: 0, base: 0, step: 0, max: 0 });
      expect(g.kinds.armoured, g.id).toEqual({ from: 0, base: 0, step: 0, max: 0 });
    }
    for (const id of VOID_RIFT) {
      const g = galaxyById(id);
      expect(g.kinds.phaser.base, id).toBe(0.12);
      expect(g.kinds.armoured.base, id).toBe(0.1);
    }
    const first = galaxyById('4-1');
    expect(kindProbability(first.kinds.phaser, tierOf(first))).toBeCloseTo(0.12, 9);
    expect(kindProbability(first.kinds.armoured, tierOf(first))).toBeCloseTo(0.1, 9);
  });

  it('leaves Crimson Nebula\'s gunship and mine ramps on Dimension 3 as they were', () => {
    expect(galaxyById('3-1').kinds.gunship).toEqual({ from: 2, base: 0.1, step: 0.2, max: 0.3 });
    expect(galaxyById('3-1').kinds.mine).toEqual({ from: 2, base: 0, step: 0.3, max: 0.18 });
  });

  it("keeps Dimension 3's foes at slightly lower maxima on Void Rift", () => {
    for (const id of VOID_RIFT) {
      expect(galaxyById(id).kinds.gunship.max, id).toBeLessThan(0.3);
      expect(galaxyById(id).kinds.mine.max, id).toBeLessThan(0.18);
    }
  });

  it('prices a phaser at 2.5 and an armoured rock at 4 on the threat budget', () => {
    expect(THREAT_COST.phaser).toBe(2.5);
    expect(THREAT_COST.armoured).toBe(4);
  });

  it('schedules each Void Rift galaxy\'s repulsion fields and warp rifts exactly as the rules set them', () => {
    const planned = (id: GalaxyId): [GalaxyEvent['type'], number, number][] => scheduled(id).map((e) => [e.type, e.at, e.intensity]);
    expect(planned('4-1')).toEqual([]);
    expect(planned('4-2')).toEqual([['repulsionField', 25, 1]]);
    expect(planned('4-3')).toEqual([
      ['warpRift', 20, 1],
      ['repulsionField', 80, 1],
    ]);
    expect(planned('4-4')).toEqual([
      ['warpRift', 20, 1],
      ['repulsionField', 56, 2],
    ]);
    expect(planned('4-5')).toEqual([
      ['warpRift', 15, 2],
      ['repulsionField', 56, 2],
    ]);
  });

  it('warns of every rift and repulsion field for its whole telegraph, and of every phaser blink, on 4-2 to 4-5 under expert, statue and casual', () => {
    let blinks = 0;
    for (const id of VOID_RIFT.slice(1)) {
      for (const profile of ['expert', 'casual', 'statue'] as const) {
        for (const seed of [1, 2, 3]) {
          const log: TimedEvent[] = [];
          const result = runGalaxy({
            galaxy: galaxyById(id),
            seed,
            profile,
            onStep: (world, _controls, events) => {
              for (const event of events) log.push({ elapsed: world.elapsed, event: { ...event } });
            },
          });
          const pairs = auditTelegraphs(log);
          blinks += auditFoeAttacks(log).filter((p) => p.kind === 'phaser').length;
          // A cleared run has met every hazard its schedule shows: a rift pair per intensity to two, a repulsion field per event.
          if (result.cleared) {
            const expected = scheduled(id).reduce((sum, e) => sum + (e.type === 'warpRift' ? Math.min(e.intensity, 2) : 1), 0);
            expect(pairs.length, `${id} ${profile} seed ${String(seed)}`).toBe(expected);
          }
        }
      }
    }
    expect(blinks).toBeGreaterThan(0);
  }, 600_000);
});
