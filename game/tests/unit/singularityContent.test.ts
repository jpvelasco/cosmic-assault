import { describe, expect, it } from 'vitest';
import { kindProbability } from '../../src/content/curves';
import { GALAXIES, galaxyById, tierOf } from '../../src/content/galaxies';
import type { FoeKind, GalaxyEvent, GalaxyId, ThreatKind } from '../../src/content/types';
import { isFoeKind } from '../../src/content/foes';
import { eventSeconds } from '../../src/content/curves';

const SINGULARITY: readonly GalaxyId[] = ['5-1', '5-2', '5-3', '5-4', '5-5'];
const FOE_KINDS: readonly FoeKind[] = ['splitter', 'drone', 'gunship', 'mine', 'phaser', 'armoured'];
const scheduled = (id: GalaxyId): GalaxyEvent[] => galaxyById(id).events.filter((e) => e.type !== 'meteorShower');

describe('Singularity content', () => {
  it('mixes every foe in: each kind is on the field somewhere in Dimension 5, with a maximum of 0.2 to 0.25', () => {
    for (const id of SINGULARITY) {
      const g = galaxyById(id);
      for (const kind of FOE_KINDS) {
        const ramp = g.kinds[kind as ThreatKind];
        expect(ramp.max, `${id} ${kind}`).toBeGreaterThanOrEqual(0.2);
        expect(ramp.max, `${id} ${kind}`).toBeLessThanOrEqual(0.25);
        expect(ramp.base, `${id} ${kind}`).toBeLessThanOrEqual(ramp.max);
      }
    }
  });

  it('keeps the large rocks Void Rift brings, and names each foe kind as one the game knows', () => {
    for (const kind of FOE_KINDS) expect(isFoeKind(kind), kind).toBe(true);
    expect(galaxyById('5-1').kinds.large.base).toBe(0.45);
  });

  it('gives a foe its probability at a Dimension 5 tier from its ramp, never past its maximum', () => {
    for (const id of SINGULARITY) {
      const g = galaxyById(id);
      for (const kind of FOE_KINDS) expect(kindProbability(g.kinds[kind as ThreatKind], tierOf(g)), `${id} ${kind}`).toBeLessThanOrEqual(0.25);
    }
  });

  it('schedules a black hole at 12 s in every survival galaxy, with a hole at intensity 1 in 5-1 and 5-2, 2 in 5-3 and 5-4, 3 in 5-5', () => {
    const holes = (id: GalaxyId) => scheduled(id).filter((e) => e.type === 'blackHole');
    expect(holes('5-1')).toEqual([{ at: 12, type: 'blackHole', intensity: 1 }]);
    expect(holes('5-2')).toEqual([{ at: 12, type: 'blackHole', intensity: 1 }]);
    expect(holes('5-3')).toEqual([{ at: 12, type: 'blackHole', intensity: 2 }]);
    expect(holes('5-4')).toEqual([{ at: 12, type: 'blackHole', intensity: 2 }]);
    expect(holes('5-5')).toEqual([{ at: 12, type: 'blackHole', intensity: 3 }]);
  });

  it('schedules Singularity\'s other hazards as set out above, one hole each galaxy', () => {
    const planned = (id: GalaxyId): [GalaxyEvent['type'], number, number][] => scheduled(id).map((e) => [e.type, e.at, e.intensity]);
    expect(planned('5-1')).toEqual([['blackHole', 12, 1]]);
    expect(planned('5-2')).toEqual([
      ['blackHole', 12, 1],
      ['dangerZone', 30, 1],
    ]);
    expect(planned('5-3')).toEqual([
      ['blackHole', 12, 2],
      ['warpRift', 25, 1],
      ['dangerZone', 100, 1],
    ]);
    expect(planned('5-4')).toEqual([
      ['blackHole', 12, 2],
      ['repulsionField', 25, 1],
      ['dangerZone', 100, 1],
    ]);
    expect(planned('5-5')).toEqual([
      ['blackHole', 12, 3],
      ['warpRift', 22, 1],
      ['dangerZone', 60, 1],
    ]);
    for (const id of SINGULARITY) expect(scheduled(id).filter((e) => e.type === 'blackHole'), id).toHaveLength(1);
  });

  it('ends each black hole before the lull, at 87 s, so a survival galaxy\'s lull is never under it', () => {
    for (const id of SINGULARITY) {
      const hole = scheduled(id).find((e) => e.type === 'blackHole');
      expect(hole, id).toBeDefined();
      expect((hole?.at ?? 0) + eventSeconds(hole as GalaxyEvent), id).toBe(87);
    }
  });

  it('starts each black hole with no other pull active: no gravity well or repulsion field is in play at the hole\'s start', () => {
    for (const id of SINGULARITY) {
      const hole = scheduled(id).find((e) => e.type === 'blackHole');
      for (const e of scheduled(id)) {
        if (e.type !== 'gravityWell' && e.type !== 'repulsionField') continue;
        const from = e.at;
        const until = e.at + eventSeconds(e);
        expect(hole !== undefined && hole.at >= from && hole.at < until, `${id} ${e.type} at ${String(e.at)}`).toBe(false);
      }
    }
  });

  it('keeps no boss galaxy under a hole, so a respawn never has to respect a boss\'s clearance and a hole', () => {
    for (const g of GALAXIES.filter((x) => x.kind === 'boss')) expect(g.events.some((e) => e.type === 'blackHole'), g.id).toBe(false);
  });
});
