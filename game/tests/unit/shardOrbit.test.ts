import { describe, expect, it } from 'vitest';
import type { AttackSpec, BossBehaviour, BossSetup } from '../../src/sim/boss/behaviour';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { ShardOrbit, type ShardOrbitOptions } from '../../src/sim/boss/shardOrbit';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, breakPart, FIXTURE_DEF, liveParts, runFor, type StubArena, stubArena } from '../helpers/bossArena';

/** Six shards of radius 10 on an orbit of 80, held still so each slot stays where it is. */
const STILL: ShardOrbitOptions = { counts: [6, 6], hp: 2, radius: 10, orbit: 80, speed: 0, exposedAt: 3, regrowSeconds: 1, regrowCap: 4 };
const SPEC: AttackSpec = { windup: 0.5, active: 0, run: () => undefined };

interface Orbit {
  readonly orbit: ShardOrbit;
  readonly runner: BossRunner;
  readonly arena: StubArena;
}

/** A shard orbit under a fight, its core at the field's centre and its shards broken until the core is bare (three standing). */
function bareOrbit(options: ShardOrbitOptions): Orbit {
  const arena = stubArena();
  const setup: BossSetup = { maxHp: 30, rng: createRng(4), rockSpeed: 1, field: BOSS_FIELD };
  const orbit = new ShardOrbit(options, setup, { x: BOSS_FIELD.width / 2, y: BOSS_FIELD.height / 2 });
  const behaviour: BossBehaviour = { driftSpeed: 0, parts: orbit.parts, reach: orbit.reach, attacks: { quake: SPEC, dive: SPEC }, vulnerable: () => orbit.exposed, step: (ctx) => { orbit.step(ctx); } };
  const runner = new BossRunner({ ...FIXTURE_DEF, phases: [['quake'], ['quake'], ['quake']] }, behaviour, setup);
  runFor((dt, a) => { runner.step(dt, a); }, arena, 2.05);
  for (let i = 0; i < orbit.parts.length && !runner.view.vulnerable; i++) breakPart(runner, i);
  return { orbit, runner, arena };
}

describe('a shard orbit\'s regrowth', () => {
  it('with no grow clearance, grows the first broken shard back even where the ship lies on it, as the Monolith\'s always has', () => {
    const { orbit, runner, arena } = bareOrbit(STILL);
    const first = orbit.parts[0];
    expect(first?.hp).toBe(0);
    Object.assign(arena.ship, { x: first?.x, y: first?.y });
    runFor((dt, a) => { runner.step(dt, a); }, arena, 1.2);
    expect(orbit.parts[0]?.hp).toBe(2);
  });

  it('with a grow clearance, skips a broken slot the ship lies too near and grows the next clear one', () => {
    const { orbit, runner, arena } = bareOrbit({ ...STILL, growClearance: 60 });
    const first = orbit.parts[0];
    Object.assign(arena.ship, { x: first?.x, y: first?.y });
    runFor((dt, a) => { runner.step(dt, a); }, arena, 1.2);
    expect(orbit.parts[0]?.hp, 'the slot the ship is on stays empty').toBe(0);
    expect(orbit.parts[1]?.hp, 'the next broken slot clear of the ship grows').toBe(2);
    expect(liveParts(orbit).length).toBe(4);
  });

  it('waits while every broken slot lies too near the ship, then grows in once one is clear, never nearer than the clearance', () => {
    const clearance = 150;
    const { orbit, runner, arena } = bareOrbit({ ...STILL, growClearance: clearance });
    // Every slot lies 80 from the core's centre, inside 150: the ship is on the core.
    Object.assign(arena.ship, { x: runner.view.x, y: runner.view.y });
    runFor((dt, a) => { runner.step(dt, a); }, arena, 3.5);
    expect(liveParts(orbit).length, 'deferred while every slot is near').toBe(3);
    Object.assign(arena.ship, { x: 40, y: 40 });
    runFor((dt, a) => { runner.step(dt, a); }, arena, 0.1);
    expect(liveParts(orbit).length, 'grows once a slot is clear').toBe(4);
    const grown = orbit.parts.filter((p) => p.hp > 0 && p.maxHp === 2).find((p) => Math.hypot(p.x - arena.ship.x, p.y - arena.ship.y) < clearance);
    expect(grown, 'no regrown shard sits within the clearance of the ship').toBeUndefined();
  });
});
