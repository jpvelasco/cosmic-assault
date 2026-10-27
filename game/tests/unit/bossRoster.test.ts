import { describe, expect, it } from 'vitest';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { BossId } from '../../src/content/types';
import { aimedBoltsAttack, dash, dashAttack, fireBolt, pulseAttack, radialBoltsAttack } from '../../src/sim/boss/attacks';
import type { AttackSpec, BossBehaviour, BossPart, BossSetup } from '../../src/sim/boss/behaviour';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { createMonolith, MONOLITH_SHARDS } from '../../src/sim/boss/monolith';
import { BOSS_BEHAVIOURS } from '../../src/sim/boss/roster';
import { ShardOrbit } from '../../src/sim/boss/shardOrbit';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import { FoeField } from '../../src/sim/foes/foeField';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena, FIXTURE_DEF, FIXTURE } from '../helpers/bossArena';
import { ATTACK_TELEGRAPHS, auditAttacks, fightRecorder } from '../helpers/telegraphAudit';

const BOSS_IDS = Object.keys(BOSS_BEHAVIOURS) as BossId[];

function setupFor(field: Field, arena: StubArena = stubArena(undefined, field)): BossSetup {
  const foes = new FoeField(arena, createRng(2), { score: (base) => base, killed: () => undefined });
  return { maxHp: 60, rng: createRng(1), rockSpeed: 1, field, foes, bolts: new Bolts(arena) };
}

describe('the boss roster', () => {
  it('gives every attack of every boss a telegraph of at least the minimum windup', () => {
    for (const id of BOSS_IDS) {
      for (const [attack, spec] of Object.entries(BOSS_BEHAVIOURS[id](setupFor(BOSS_FIELD)).attacks)) expect(spec.windup, `${id} ${attack}`).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
    }
  });
});

describe('the shared attack library', () => {
  it('builds a pulse or a dash as a whole attack, its declared threat matching what it does', () => {
    expect(pulseAttack(0.5, 0.3, 260, 320)).toMatchObject({ windup: 0.5, active: 0.3, threat: { kind: 'shove', speed: 260, reach: 320 } });
    expect(dashAttack(0.7, 1, 70)).toMatchObject({ windup: 0.7, active: 1, threat: { kind: 'lane', reach: 'core' } });
  });

  it("runs the fixture's dive as the shared dash over its 0.8 s, and makes the Monolith's shards a ShardOrbit of its options", () => {
    const arena = stubArena();
    const fixture = new BossRunner(FIXTURE_DEF, FIXTURE, { maxHp: 30, rng: createRng(5), rockSpeed: 1, field: BOSS_FIELD });
    const dashed = new BossRunner(FIXTURE_DEF, { ...FIXTURE, attacks: { ...FIXTURE.attacks, dive: { ...FIXTURE.attacks.dive, run: (ctx) => { dash(ctx, 0.8); } } } }, { maxHp: 30, rng: createRng(5), rockSpeed: 1, field: BOSS_FIELD });
    const poses: number[][] = [[], []];
    runFor((dt, a) => {
      fixture.step(dt, a);
      dashed.step(dt, a);
      poses[0]?.push(fixture.view.x, fixture.view.y);
      poses[1]?.push(dashed.view.x, dashed.view.y);
      if (fixture.view.active === null && fixture.hp > 12) {
        fixture.hit(1);
        dashed.hit(1);
      }
    }, arena, 20);
    expect(poses[1]).toEqual(poses[0]);
    const shards = new ShardOrbit(MONOLITH_SHARDS, setupFor(BOSS_FIELD)).parts;
    expect(createMonolith(setupFor(BOSS_FIELD)).parts).toEqual(shards);
  });

  /** The fixture fights stand their bolt attacks in for the fixture's two. */
  const BOLT_HARMS = { ...ATTACK_TELEGRAPHS, quake: 'bolts', dive: 'bolts' } as const;

  /** A fight whose every attack is `spec`, on a stub arena with bolts, its fight steps recorded for the audit. */
  function boltFight(spec: AttackSpec, parts: readonly BossPart[] = []) {
    const arena = stubArena();
    const setup = setupFor(BOSS_FIELD, arena);
    const bolts = setup.bolts as Bolts;
    const runner = new BossRunner(FIXTURE_DEF, { driftSpeed: 0, parts, attacks: { quake: spec, dive: spec } }, setup);
    const recorder = fightRecorder();
    const source = { get elapsed() { return arena.elapsed(); }, boss: runner.view, asteroids: arena.asteroids, foes: [], bolts: bolts.list };
    const log = runFor((dt, a) => { runner.step(dt, a); }, arena, 6, () => { recorder.record(source, arena.events); });
    return { runner, bolts, log, pairs: auditAttacks(recorder.steps, BOLT_HARMS) };
  }

  it("fires attack bolts only once the attack's own windup has run, each marked as its attack's", () => {
    const { bolts, log, pairs } = boltFight(aimedBoltsAttack(0.7, 3, 0.4, 200));
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) expect(pair.harm).toEqual(new Set(['bolts']));
    expect(timedOfType(log, 'boltFired')[0]?.event.source).toBe('boss');
    for (const bolt of bolts.list) expect(bolt.fromAttack).toBe(true);
  });

  it('fans aimed bolts across their spread about the bearing to where the ship was as the windup began', () => {
    const { runner, log } = boltFight(aimedBoltsAttack(0.5, 3, 0.4, 200));
    const [first] = timedOfType(log, 'bossWindup');
    const volley = timedOfType(log, 'boltFired').filter((l) => l.at === timedOfType(log, 'boltFired')[0]?.at);
    expect(first).toBeDefined();
    expect(volley).toHaveLength(3);
    const aim = Math.atan2(600 - runner.view.y, BOSS_FIELD.width / 2 - runner.view.x);
    expect(volley.map((l) => l.event.angle)).toEqual([aim - 0.2, aim, aim + 0.2].map((a) => expect.closeTo(a, 9) as number));
  });

  it('fires radial bolts outward from the core through each live part, from the part, and none from a broken one', () => {
    const parts: BossPart[] = [0, 1, 2, 3].map((i) => ({ x: 640 + Math.cos(i * Math.PI / 2) * 100, y: 201.6 + Math.sin(i * Math.PI / 2) * 100, px: 0, py: 0, radius: 12, hp: i === 2 ? 0 : 1, maxHp: 1 }));
    const { log } = boltFight(radialBoltsAttack(0.6, parts, 230), parts);
    const volley = timedOfType(log, 'boltFired').filter((l) => l.at === timedOfType(log, 'boltFired')[0]?.at);
    expect(volley.map((l) => [Math.round(l.event.x), Math.round(l.event.y)])).toEqual([[740, 202], [640, 302], [640, 102]]);
    expect(volley.map((l) => l.event.angle)).toEqual([0, Math.PI / 2, -Math.PI / 2].map((a) => expect.closeTo(a, 9) as number));
  });

  it('refuses attack output from a behaviour\'s step, which no windup telegraphs, saying where it belongs', () => {
    const arena = stubArena();
    const setup = setupFor(BOSS_FIELD, arena);
    const spec: AttackSpec = { windup: 0.5, active: 0, run: () => undefined };
    const sly: BossBehaviour = { driftSpeed: 0, attacks: { quake: spec, dive: spec }, step: (ctx) => { if (ctx.boss.windup !== null) fireBolt(ctx, ctx.boss.x, ctx.boss.y, 0); } };
    const runner = new BossRunner(FIXTURE_DEF, sly, setup);
    expect(() => runFor((dt, a) => { runner.step(dt, a); }, arena, 6)).toThrow(/step .*attack's run/);
    const shover: BossBehaviour = { driftSpeed: 0, attacks: { quake: spec, dive: spec }, step: (ctx) => { ctx.shoveX = 50; } };
    const pushy = new BossRunner(FIXTURE_DEF, shover, setupFor(BOSS_FIELD, arena));
    expect(() => runFor((dt, a) => { pushy.step(dt, a); }, arena, 1)).toThrow(/step .*attack's run/);
  });

  it('refuses a bolt from a fight with no bolts to fire, saying how to give it some', () => {
    const arena = stubArena();
    const volley: AttackSpec = { windup: 0.5, active: 0, run: (ctx) => { fireBolt(ctx, ctx.boss.x, ctx.boss.y, 0, 230); } };
    const runner = new BossRunner(FIXTURE_DEF, { driftSpeed: 0, attacks: { quake: volley, dive: volley } }, { maxHp: 30, rng: createRng(5), rockSpeed: 1, field: BOSS_FIELD });
    expect(() => runFor((dt, a) => { runner.step(dt, a); }, arena, 6)).toThrow(/setup\.bolts/);
  });
});

describe('a ShardOrbit', () => {
  const OPTIONS = { counts: [6, 6], hp: 2, radius: 10, orbit: 80, speed: 1, exposedAt: 3, regrowSeconds: 1, regrowCap: 3 } as const;
  const liveShards = (orbit: ShardOrbit): number => orbit.parts.filter((p) => p.hp > 0).length;

  function orbiting(): { orbit: ShardOrbit; runner: BossRunner; arena: StubArena } {
    const arena = stubArena();
    const setup = setupFor(BOSS_FIELD, arena);
    const orbit = new ShardOrbit(OPTIONS, setup);
    const spec: AttackSpec = { windup: 0.5, active: 0, run: () => undefined };
    const behaviour: BossBehaviour = { driftSpeed: 0, parts: orbit.parts, reach: orbit.reach, attacks: { quake: spec, dive: spec }, vulnerable: () => orbit.exposed, step: (ctx) => { orbit.step(ctx); } };
    const runner = new BossRunner(FIXTURE_DEF, behaviour, setup);
    runFor((dt, a) => { runner.step(dt, a); }, arena, 2.05);
    return { orbit, runner, arena };
  }

  it('makes its shards from its options, on their orbit, reaching the orbit plus a shard', () => {
    const { orbit, runner } = orbiting();
    expect(orbit.parts).toHaveLength(6);
    expect(orbit.reach).toBe(90);
    for (const part of orbit.parts) {
      expect(part).toMatchObject({ hp: 2, maxHp: 2, radius: 10 });
      expect(Math.hypot(part.x - runner.view.x, part.y - runner.view.y)).toBeCloseTo(80, 6);
    }
  });

  it('lays the core bare at its threshold, and regrows a shard a second while bare, up to its cap', () => {
    const { orbit, runner, arena } = orbiting();
    for (let i = 0; i < 2; i++) while ((orbit.parts[i]?.hp ?? 0) > 0) runner.hitPart(i, 1);
    expect(orbit.exposed).toBe(false);
    for (let i = 2; i < 4; i++) while ((orbit.parts[i]?.hp ?? 0) > 0) runner.hitPart(i, 1);
    expect(liveShards(orbit)).toBe(2);
    expect(orbit.exposed).toBe(true);
    runFor((dt, a) => { runner.step(dt, a); }, arena, 1.05);
    expect(liveShards(orbit)).toBe(3);
    // Still bare at three, it is the cap that stops it.
    runFor((dt, a) => { runner.step(dt, a); }, arena, 3);
    expect(liveShards(orbit)).toBe(3);
    expect(orbit.exposed).toBe(true);
  });

  it('throws its shards as a volley whose lane reaches its spread plus a shard', () => {
    const { orbit } = orbiting();
    const volley = orbit.volley(0.9);
    expect(volley).toMatchObject({ windup: 0.9, active: 1.8, threat: { kind: 'lane', reach: 46 + 10 } });
  });

  it('takes a volley of its own and a home of its own, for a boss that is not the Monolith', () => {
    const setup = setupFor(BOSS_FIELD);
    const orbit = new ShardOrbit({ ...OPTIONS, volley: { shards: 2, seconds: 1.2, spread: 30, overshoot: 40 } }, setup, { x: 300, y: 300 });
    expect(orbit.volley(0.6)).toMatchObject({ active: 1.2, threat: { kind: 'lane', reach: 30 + 10 } });
    for (const part of orbit.parts) expect(Math.hypot(part.x - 300, part.y - 300)).toBeCloseTo(80, 6);
  });
});
