import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/content/bosses';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { BossId } from '../../src/content/types';
import { dash, dashAttack, fireBolt, launchDrones, pulse, pulseAttack, rockRing } from '../../src/sim/boss/attacks';
import type { AttackSpec, BossBehaviour, BossSetup } from '../../src/sim/boss/behaviour';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { createMonolith, MONOLITH_SHARDS } from '../../src/sim/boss/monolith';
import { BOSS_BEHAVIOURS } from '../../src/sim/boss/roster';
import { SENTINEL } from '../../src/sim/boss/sentinel';
import { ShardOrbit } from '../../src/sim/boss/shardOrbit';
import { FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import { FoeField } from '../../src/sim/foes/foeField';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena } from '../helpers/bossArena';

const fieldAt = (aspect: number): Field => ({ width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT });
const BOSS_IDS = Object.keys(BOSS_BEHAVIOURS) as BossId[];

function setupFor(field: Field, arena: StubArena = stubArena(undefined, field)): BossSetup {
  const foes = new FoeField(arena, createRng(2), { score: (base) => base, killed: () => undefined });
  return { maxHp: 60, rng: createRng(1), rockSpeed: 1, field, foes, bolts: new Bolts(arena) };
}

describe('the boss roster', () => {
  it.each([
    { label: '4:3', aspect: MIN_ASPECT },
    { label: '21:9', aspect: MAX_ASPECT },
  ])('keeps every boss, as it arrives, out of reach of a ship parked at the field\'s centre at $label', ({ aspect }) => {
    const field = fieldAt(aspect);
    for (const id of BOSS_IDS) {
      const setup = setupFor(field);
      const runner = new BossRunner(BOSSES[id], BOSS_BEHAVIOURS[id](setup), setup);
      const home = runner.view;
      expect(runner.reach + PLAYER.radius, id).toBeLessThan(Math.hypot(home.x - field.width / 2, home.y - field.height / 2));
    }
  });

  it('gives every attack of every boss a telegraph of at least the minimum windup', () => {
    for (const id of BOSS_IDS) {
      for (const [attack, spec] of Object.entries(BOSS_BEHAVIOURS[id](setupFor(BOSS_FIELD)).attacks)) expect(spec.windup, `${id} ${attack}`).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
    }
  });
});

describe('the shared attack library', () => {
  it('holds the moves the bosses share: rock rings, pulses, dashes, drone launches and bolts', () => {
    for (const move of [rockRing, pulse, dash, launchDrones, fireBolt]) expect(typeof move).toBe('function');
  });

  it('builds a pulse or a dash as a whole attack, its declared threat matching what it does', () => {
    expect(pulseAttack(0.5, 0.3, 260, 320)).toMatchObject({ windup: 0.5, active: 0.3, threat: { kind: 'shove', speed: 260, reach: 320 } });
    expect(dashAttack(0.7, 1)).toMatchObject({ windup: 0.7, active: 1, threat: { kind: 'lane', reach: 'core' } });
  });

  it("runs the Sentinel's lunge as the shared dash, and the Monolith's shards as a ShardOrbit", () => {
    const arena = stubArena();
    const sentinel = new BossRunner(BOSSES.sentinel, SENTINEL, { maxHp: 30, rng: createRng(5), rockSpeed: 1, field: BOSS_FIELD });
    const dashed = new BossRunner(BOSSES.sentinel, { ...SENTINEL, attacks: { ...SENTINEL.attacks, lunge: { ...SENTINEL.attacks.lunge, run: (ctx) => { dash(ctx, 0.8); } } } }, { maxHp: 30, rng: createRng(5), rockSpeed: 1, field: BOSS_FIELD });
    const poses: number[][] = [[], []];
    runFor((dt, a) => {
      sentinel.step(dt, a);
      dashed.step(dt, a);
      poses[0]?.push(sentinel.view.x, sentinel.view.y);
      poses[1]?.push(dashed.view.x, dashed.view.y);
      if (sentinel.view.active === null && sentinel.hp > 12) {
        sentinel.hit(1);
        dashed.hit(1);
      }
    }, arena, 20);
    expect(poses[1]).toEqual(poses[0]);
    const shards = new ShardOrbit(MONOLITH_SHARDS, setupFor(BOSS_FIELD)).parts;
    expect(createMonolith(setupFor(BOSS_FIELD)).parts).toEqual(shards);
  });

  it('fires attack bolts from the boss, marked as its attack\'s as they are made', () => {
    const arena = stubArena();
    const setup = setupFor(BOSS_FIELD, arena);
    const bolts = setup.bolts as Bolts;
    const volley: AttackSpec = { windup: 0.5, active: 0, run: (ctx) => { fireBolt(ctx, ctx.boss.x, ctx.boss.y, Math.PI / 2, 230); } };
    const behaviour: BossBehaviour = { driftSpeed: 0, attacks: { shardRing: volley, lunge: volley } };
    const runner = new BossRunner(BOSSES.sentinel, behaviour, setup);
    const firstBolt: number[] = [];
    const log = runFor((dt, a) => { runner.step(dt, a); }, arena, 6, () => {
      if (bolts.list.length > 0 && firstBolt.length === 0) firstBolt.push(arena.elapsed());
    });
    const [windup] = timedOfType(log, 'bossWindup');
    expect(windup).toBeDefined();
    expect((firstBolt[0] ?? 0) - (windup?.at ?? 0)).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(timedOfType(log, 'boltFired')[0]?.event.source).toBe('boss');
    for (const bolt of bolts.list) expect(bolt.fromAttack).toBe(true);
  });

  it('refuses a bolt from a fight with no bolts to fire, saying how to give it some', () => {
    const arena = stubArena();
    const volley: AttackSpec = { windup: 0.5, active: 0, run: (ctx) => { fireBolt(ctx, ctx.boss.x, ctx.boss.y, 0, 230); } };
    const runner = new BossRunner(BOSSES.sentinel, { driftSpeed: 0, attacks: { shardRing: volley, lunge: volley } }, { maxHp: 30, rng: createRng(5), rockSpeed: 1, field: BOSS_FIELD });
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
    const behaviour: BossBehaviour = { driftSpeed: 0, parts: orbit.parts, reach: orbit.reach, attacks: { shardRing: spec, lunge: spec }, vulnerable: () => orbit.exposed, step: (ctx) => { orbit.step(ctx); } };
    const runner = new BossRunner(BOSSES.sentinel, behaviour, setup);
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
});
