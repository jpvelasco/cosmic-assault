import { describe, expect, it } from 'vitest';
import { HAZARD_RULES } from '../../src/content/hazards';
import type { GalaxyId } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';
import { playScripted } from '../helpers/eventDigest';
import { auditTelegraphs, type TimedEvent } from '../helpers/telegraphAudit';

const WELL_GALAXIES: readonly GalaxyId[] = ['2-2', '2-3', '2-4', '2-5'];

function timedLog(id: GalaxyId, seed: number): TimedEvent[] {
  const log: TimedEvent[] = [];
  playScripted(id, seed, (world, events) => {
    for (const event of events) log.push({ elapsed: world.elapsed, event: { ...event } });
  });
  return log;
}

const at = (elapsed: number, event: SimEvent): TimedEvent => ({ elapsed, event });

describe('auditTelegraphs', () => {
  it.each(WELL_GALAXIES)('finds every gravity well of %s warned its full 2 s before it pulls, on seeds 1–3', (id) => {
    const pairs = [1, 2, 3].flatMap((seed) => auditTelegraphs(timedLog(id, seed)));
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.kind).toBe('gravityWell');
      expect(pair.minimum).toBe(HAZARD_RULES.gravityWell.telegraph);
      expect(pair.active - pair.warned).toBeGreaterThanOrEqual(pair.minimum - 1e-6);
    }
  });

  it('pairs a warning and its activation by id, not by order', () => {
    const pairs = auditTelegraphs([
      at(1, { type: 'wellWarning', id: 4, kind: 'gravityWell', x: 0, y: 0, at: 3 }),
      at(1.5, { type: 'wellWarning', id: 5, kind: 'repulsionField', x: 0, y: 0, at: 3.5 }),
      at(3.5, { type: 'wellStart', id: 5, kind: 'repulsionField' }),
      at(3, { type: 'wellStart', id: 4, kind: 'gravityWell' }),
    ]);
    expect(pairs).toEqual([
      { id: 5, kind: 'repulsionField', warned: 1.5, active: 3.5, minimum: 2 },
      { id: 4, kind: 'gravityWell', warned: 1, active: 3, minimum: 2 },
    ]);
  });

  it('fails a hazard that turns hostile before its telegraph has run, naming it', () => {
    const log = [at(1, { type: 'wellWarning', id: 4, kind: 'gravityWell', x: 0, y: 0, at: 2.5 }), at(2.5, { type: 'wellStart', id: 4, kind: 'gravityWell' })];
    expect(() => auditTelegraphs(log)).toThrow(/gravityWell 4 .*1\.5 s.*2 s/);
  });

  it('fails an activation that was never warned', () => {
    expect(() => auditTelegraphs([at(3, { type: 'wellStart', id: 9, kind: 'gravityWell' })])).toThrow(/gravityWell 9 .*no warning/);
  });

  it('ignores events that are not telegraphed hazards', () => {
    expect(auditTelegraphs([at(1, { type: 'shot', x: 0, y: 0 }), at(2, { type: 'wellEnd', id: 1, kind: 'gravityWell' })])).toEqual([]);
  });
});
