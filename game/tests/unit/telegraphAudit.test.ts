import { describe, expect, it } from 'vitest';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { bossTarget } from '../../src/sim/boss/bossRules';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { GALAXIES, galaxyById } from '../../src/content/galaxies';
import { HAZARD_RULES } from '../../src/content/hazards';
import type { GalaxyId, HazardType } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';
import type { AttackId } from '../../src/content/types';
import { BOSS_BEHAVIOURS } from '../../src/sim/boss/roster';
import { HAZARD_FACTORIES } from '../../src/sim/hazards/hazardField';
import { playExpert } from '../helpers/eventDigest';
import { ATTACK_TELEGRAPHS, auditAttacks, auditTelegraphs, fightRecorder, HAZARD_TELEGRAPHS, type AttackPair, type FightStep, type TimedEvent } from '../helpers/telegraphAudit';

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

/** Every boss galaxy, each with its own boss: the Monolith, the Hive Carrier and the Sentinel. */
const BOSS_GALAXIES = ['1-6', '2-6', '3-6'] as const;

/** Seconds between the blows that walk a boss through its phases, slow enough for each phase to show its attacks. */
const BLOW_SECONDS = 1;
const FIGHT_SECONDS = BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + 150;

/**
 * The fight in `id` on `seed`, step by step, audited: an idle ship kept unhurt, so the fight runs its course, and one
 * blow a second wherever a shot does harm, so the boss goes through all three phases before it falls.
 */
function auditedFight(id: GalaxyId, seed: number): AttackPair[] {
  const world = new World({ seed, field: { width: 1280, height: 720 }, rules: { kind: 'galaxy', galaxy: galaxyById(id), mode: 'free' } });
  const recorder = fightRecorder();
  const blowEvery = Math.round(BLOW_SECONDS / STEP_SECONDS);
  for (let step = 0; step * STEP_SECONDS < FIGHT_SECONDS && world.status === 'playing'; step++) {
    Object.assign(world['shipState'], { invulnerable: true, invulnerableFor: 1 });
    const target = world.boss === null ? null : bossTarget(world.boss);
    if (target !== null && step % blowEvery === 0) world['run']?.bosses.hitBoss(target.x, target.y, 1);
    recorder.record(world, world.step(STEP_SECONDS, NO_CONTROLS));
  }
  expect(world.status, `${id} seed ${String(seed)}`).not.toBe('playing');
  return auditAttacks(recorder.steps);
}

const step = (elapsed: number, over: Partial<FightStep> = {}): FightStep => ({ elapsed, events: [], active: null, made: { rocks: 0, foes: 0, bolts: 0 }, ...over });
const windup = (attack: AttackId): SimEvent => ({ type: 'bossWindup', attack, x: 0, y: 0 });

describe('auditAttacks', () => {
  it('names the harm of every attack any boss makes: a new attack cannot slip past the audit', () => {
    const setup = { maxHp: 30, rng: createRng(1), rockSpeed: 1, field: { width: 1280, height: 720 }, foes: { launch: () => false, launched: 0 } };
    for (const make of Object.values(BOSS_BEHAVIOURS)) for (const attack of Object.keys(make(setup).attacks) as AttackId[]) expect(ATTACK_TELEGRAPHS[attack], attack).toBeDefined();
  });

  it('finds every boss attack warned for at least the minimum windup before it does harm, and sees each one do its harm, on seeds 1–3', () => {
    const harmed = new Map<AttackId, Set<string>>();
    for (const id of BOSS_GALAXIES) {
      for (const seed of SEEDS) {
        for (const pair of auditedFight(id, seed)) {
          const seen = harmed.get(pair.attack) ?? new Set<string>();
          for (const harm of pair.harm) seen.add(harm);
          harmed.set(pair.attack, seen);
        }
      }
    }
    for (const [attack, harm] of Object.entries(ATTACK_TELEGRAPHS)) expect([...(harmed.get(attack as AttackId) ?? [])], attack).toContain(harm);
  }, PLAY_TIMEOUT_MS * 3);

  it('pairs each attack with its windup, and sees what it makes no sooner than the minimum after', () => {
    const pairs = auditAttacks([step(1, { events: [windup('quake')] }), step(1.5, { active: 'quake' }), step(1.51, { made: { rocks: 8, foes: 0, bolts: 0 } }), step(4, { events: [windup('pulse')] }), step(4.5, { active: 'pulse' })]);
    expect(pairs.map((p) => [p.attack, p.warned, p.active, [...p.harm]])).toEqual([
      ['quake', 1, 1.5, ['rocks']],
      ['pulse', 4, 4.5, ['active']],
    ]);
  });

  it('fails an attack that goes active, or makes a rock, before the minimum windup, naming it', () => {
    expect(() => auditAttacks([step(1, { events: [windup('lunge')] }), step(1.2, { active: 'lunge' })])).toThrow(/^lunge .*went active/);
    expect(() => auditAttacks([step(1, { events: [windup('quake')] }), step(1.1, { made: { rocks: 1, foes: 0, bolts: 0 } })])).toThrow(/^quake .*made rocks/);
  });

  it('fails attack-made bodies with no attack warned, and harm an attack is not listed for', () => {
    expect(() => auditAttacks([step(1, { made: { rocks: 0, foes: 0, bolts: 2 } })])).toThrow(/no attack warned/);
    expect(() => auditAttacks([step(1, { events: [windup('quake')] }), step(2, { made: { rocks: 0, foes: 0, bolts: 2 } })])).toThrow(/quake made bolts/);
  });
});
