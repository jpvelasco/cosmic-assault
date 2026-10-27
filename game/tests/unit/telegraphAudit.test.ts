import { describe, expect, it } from 'vitest';
import { GALAXIES } from '../../src/content/galaxies';
import { HAZARD_RULES } from '../../src/content/hazards';
import type { GalaxyId, HazardType } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';
import { HAZARD_FACTORIES } from '../../src/sim/hazards/hazardField';
import { playExpert } from '../helpers/eventDigest';
import { auditTelegraphs, HAZARD_TELEGRAPHS, type TimedEvent } from '../helpers/telegraphAudit';

const SEEDS = [1, 2, 3];
/** Every galaxy that schedules a hazard, with the hazards it schedules. */
const HAZARD_GALAXIES = GALAXIES.map((g) => ({ id: g.id, hazards: g.events.flatMap((e) => (e.type === 'meteorShower' ? [] : [e.type])) })).filter((g) => g.hazards.length > 0);
/** Whole galaxies played by the expert take seconds apiece. */
const PLAY_TIMEOUT_MS = 60_000;

/** The expert's run of `id`, which clears it and so meets every hazard it schedules, as a timed log. */
function timedLog(id: GalaxyId, seed: number): TimedEvent[] {
  const log: TimedEvent[] = [];
  playExpert(id, seed, (world, events) => {
    for (const event of events) log.push({ elapsed: world.elapsed, event: { ...event } });
  });
  return log;
}

const at = (elapsed: number, event: SimEvent): TimedEvent => ({ elapsed, event });

describe('auditTelegraphs', () => {
  it('has a telegraph for every hazard that is made: a new hazard cannot slip past the audit', () => {
    for (const type of Object.keys(HAZARD_FACTORIES) as HazardType[]) expect(HAZARD_TELEGRAPHS[type], type).toBeDefined();
  });

  it('audits every galaxy that schedules a hazard, and only hazards it audits are scheduled', () => {
    expect(HAZARD_GALAXIES.map((g) => g.id)).toEqual(['2-2', '2-3', '2-4', '2-5']);
    for (const g of HAZARD_GALAXIES) for (const type of g.hazards) expect(HAZARD_TELEGRAPHS[type], `${g.id} ${type}`).toBeDefined();
  });

  it.each(HAZARD_GALAXIES)('finds every hazard of $id warned its full telegraph before it turns hostile, on seeds 1–3', ({ id, hazards }) => {
    for (const seed of SEEDS) {
      const pairs = auditTelegraphs(timedLog(id, seed));
      expect(pairs.map((p) => p.kind), `${id} seed ${String(seed)}`).toEqual(hazards);
      for (const pair of pairs) expect(pair.minimum).toBe(HAZARD_RULES[pair.kind].telegraph);
    }
  }, PLAY_TIMEOUT_MS);

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

  it('tells hazards that share events apart by their kind', () => {
    const log = [at(1, { type: 'wellWarning', id: 4, kind: 'repulsionField', x: 0, y: 0, at: 2.5 }), at(2.5, { type: 'wellStart', id: 4, kind: 'repulsionField' })];
    expect(() => auditTelegraphs(log)).toThrow(/^repulsionField 4 /);
  });

  it('ignores events that are not telegraphed hazards', () => {
    expect(auditTelegraphs([at(1, { type: 'shot', x: 0, y: 0 }), at(2, { type: 'wellEnd', id: 1, kind: 'gravityWell' })])).toEqual([]);
  });
});
