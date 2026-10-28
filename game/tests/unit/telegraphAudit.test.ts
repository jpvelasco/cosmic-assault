import { describe, expect, it } from 'vitest';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import type { BossPart } from '../../src/sim/boss/behaviour';
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
import { ATTACK_TELEGRAPHS, auditAttacks, auditFoeAttacks, auditTelegraphs, fightRecorder, HAZARD_TELEGRAPHS, hazardsShown, type AttackPair, type FightStep, type TimedEvent } from '../helpers/telegraphAudit';

const SEEDS = [1, 2, 3];
/** Every galaxy that schedules a hazard, with the hazards it shows. */
const HAZARD_GALAXIES = GALAXIES.map((g) => ({ id: g.id, hazards: g.events.flatMap(hazardsShown) })).filter((g) => g.hazards.length > 0);
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
    expect(HAZARD_GALAXIES.map((g) => g.id)).toEqual(['2-2', '2-3', '2-4', '2-5', '3-2', '3-3', '3-4', '3-5', '4-2', '4-3', '4-4', '4-5', '5-1', '5-2', '5-3', '5-4', '5-5']);
    for (const g of HAZARD_GALAXIES) for (const type of g.hazards) expect(HAZARD_TELEGRAPHS[type], `${g.id} ${type}`).toBeDefined();
  });

  // Singularity's galaxies take seconds apiece, so `tests/balance/d5-singularity.test.ts` audits them over ten seeds.
  it.each(HAZARD_GALAXIES.filter((g) => !g.id.startsWith('5-')))('finds every hazard and foe attack of $id warned its full telegraph before it turns hostile, on seeds 1–3', ({ id, hazards }) => {
    for (const seed of SEEDS) {
      const log = timedLog(id, seed);
      auditFoeAttacks(log);
      const pairs = auditTelegraphs(log);
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

describe('auditFoeAttacks', () => {
  const windup = (elapsed: number, id: number): TimedEvent => at(elapsed, { type: 'foeWindup', id, x: 0, y: 0, angle: 0 });
  const bolt = (elapsed: number, owner: number, id = 100): TimedEvent => at(elapsed, { type: 'boltFired', id, source: 'gunship', owner, x: 0, y: 0, angle: 0 });

  it('pairs each gunship bolt and mine blast with its own foe\'s warning, by id', () => {
    const pairs = auditFoeAttacks([
      windup(1, 7),
      at(1.2, { type: 'mineArmed', id: 8, x: 0, y: 0 }),
      windup(1.3, 9),
      bolt(1.5, 7),
      bolt(1.8, 9),
      at(1.8, { type: 'mineBlast', id: 8, x: 0, y: 0, radius: 80 }),
    ]);
    expect(pairs.map((p) => [p.kind, p.foe, p.warned, p.harmed])).toEqual([
      ['gunship', 7, 1, 1.5],
      ['gunship', 9, 1.3, 1.8],
      ['mine', 8, 1.2, 1.8],
    ]);
  });

  it('fails a bolt sooner than its windup, an unwarned one, and a second bolt from one windup, naming the foe', () => {
    expect(() => auditFoeAttacks([windup(1, 7), bolt(1.4, 7)])).toThrow(/^gunship 7 .*0\.4 s.*0\.5 s/);
    expect(() => auditFoeAttacks([bolt(2, 7)])).toThrow(/^gunship 7 .*no foeWindup/);
    expect(() => auditFoeAttacks([windup(1, 7), bolt(1.5, 7), bolt(1.6, 7, 101)])).toThrow(/^gunship 7 .*no foeWindup/);
    expect(() => auditFoeAttacks([at(1, { type: 'mineArmed', id: 3, x: 0, y: 0 }), at(1.5, { type: 'mineBlast', id: 3, x: 0, y: 0, radius: 80 })])).toThrow(/^mine 3 /);
  });

  it('leaves a boss\'s bolts to the boss audit', () => {
    expect(auditFoeAttacks([at(1, { type: 'boltFired', id: 4, source: 'boss', owner: 0, x: 0, y: 0, angle: 0 })])).toEqual([]);
  });
});

/** The first galaxy each boss guards, so every boss's attacks are audited. */
const BOSS_GALAXIES = GALAXIES.filter((g, i) => g.boss !== null && GALAXIES.findIndex((h) => h.boss === g.boss) === i).map((g) => g.id);

/** Seconds between the blows that walk a boss through its phases, slow enough for each phase to show its attacks. */
const BLOW_SECONDS = 1;
const FIGHT_SECONDS = BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + 300;

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
    if (target !== null && step % blowEvery === 0) {
      // A blow on a part is a blow on that part, as a shot strikes it: a shielded core is only reached through its shards.
      const run = world['run'];
      const part = world.boss?.parts.indexOf(target as BossPart) ?? -1;
      if (part >= 0) run?.bosses.hitPart(part, 1);
      else run?.bosses.hitBoss(target.x, target.y, 1);
    }
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
    expect(() => auditAttacks([step(1, { events: [windup('dive')] }), step(1.2, { active: 'dive' })])).toThrow(/^dive .*went active/);
    expect(() => auditAttacks([step(1, { events: [windup('quake')] }), step(1.1, { made: { rocks: 1, foes: 0, bolts: 0 } })])).toThrow(/^quake .*made rocks/);
  });

  it('holds an attack to its own declared windup, not only the minimum', () => {
    const log = [step(1, { events: [windup('quake')], windup: 1.2 }), step(1.5, { windup: 1.2, made: { rocks: 4, foes: 0, bolts: 0 } })];
    expect(() => auditAttacks(log)).toThrow(/^quake .*made rocks.*1\.2 s windup/);
    expect(auditAttacks([log[0] as FightStep, step(2.2, { windup: 1.2, made: { rocks: 4, foes: 0, bolts: 0 } })])[0]?.minimum).toBe(1.2);
  });

  it('fails a part moved toward or away from the core before the windup ends, naming it, and lets it move once active', () => {
    expect(() => auditAttacks([step(1, { events: [windup('quake')], parts: [100, 50] }), step(1.2, { parts: [100, 60] })])).toThrow(/^quake .*moved part 1 from 50\.0 to 60\.0/);
    const moving = [step(1, { events: [windup('pulse')], parts: [100] }), step(1.5, { active: 'pulse', parts: [200] }), step(1.6, { active: 'pulse', parts: [300] })];
    expect(auditAttacks(moving).map((p) => p.active)).toEqual([1.5]);
    // A part broken or grown back meanwhile has not moved.
    expect(() => auditAttacks([step(1, { events: [windup('quake')], parts: [100, Number.NaN] }), step(1.2, { parts: [Number.NaN, 70] })])).not.toThrow();
  });

  it('fails attack-made bodies with no attack warned, and harm an attack is not listed for', () => {
    expect(() => auditAttacks([step(1, { made: { rocks: 0, foes: 0, bolts: 2 } })])).toThrow(/no attack warned/);
    expect(() => auditAttacks([step(1, { events: [windup('quake')] }), step(2, { made: { rocks: 0, foes: 0, bolts: 2 } })])).toThrow(/quake made bolts/);
  });
});
