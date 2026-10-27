import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/content/bosses';
import type { AttackId, BossId } from '../../src/content/types';
import { radialShove } from '../../src/sim/boss/attacks';
import type { AttackContext, BossThreat } from '../../src/sim/boss/behaviour';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { BOSS_BEHAVIOURS } from '../../src/sim/boss/roster';
import { STEP_SECONDS } from '../../src/sim/config';
import { FoeField } from '../../src/sim/foes/foeField';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, runFor, stubArena, type StubArena } from '../helpers/bossArena';

const BOT_DIR = new URL('../../src/bot/', import.meta.url);
/** The boss modules a bot may read: the seam's types, the rules every fight keeps and the shared attack library. */
const GENERIC_BOSS_MODULES = ['attacks', 'behaviour', 'bossRules'];

/** A fight of boss `id` with the galaxy's foes to launch into, its intro over. */
function fight(id: BossId, arena: StubArena = stubArena()): { runner: BossRunner; arena: StubArena } {
  const foes = new FoeField(arena, createRng(2), { score: (base) => base, killed: () => undefined });
  const setup = { maxHp: 60, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD, foes };
  const runner = new BossRunner(BOSSES[id], BOSS_BEHAVIOURS[id](setup), setup);
  runFor((dt, a) => { runner.step(dt, a); }, arena, 2.05);
  return { runner, arena };
}

/** The HP that puts a 60 HP boss in `phase`. */
const PHASE_HP = { 1: 60, 2: 40, 3: 20 } as const;

/** Steps `runner` one fixed step. */
function tick(runner: BossRunner, arena: StubArena): void {
  arena.tick();
  runner.step(STEP_SECONDS, arena);
}

/**
 * Steps `runner` until its view shows `attack` winding up, first knocking it down to `phase` with blows where they
 * hurt (breaking its shards, should it shield its core behind them), and returns the threat the view shows.
 */
function windUpTo(runner: BossRunner, arena: StubArena, attack: AttackId, phase: 1 | 2 | 3): Readonly<BossThreat> | null {
  const steps = Math.round(60 / STEP_SECONDS);
  for (let i = 0; i < steps && runner.hp > PHASE_HP[phase]; i++) {
    for (const [index, part] of runner.view.parts.entries()) if (part.hp > 0 && !runner.view.vulnerable) runner.hitPart(index, part.hp);
    const target = runner.view.target;
    if (runner.view.vulnerable && target !== null) runner.hit(runner.hp - PHASE_HP[phase], target.x, target.y);
    tick(runner, arena);
  }
  for (let i = 0; i < steps && runner.view.windup !== attack; i++) tick(runner, arena);
  expect(runner.view.windup, `${attack} never wound up`).toBe(attack);
  return runner.view.threat;
}

describe('the generic boss threat view (M5-R30)', () => {
  it('lets the bots read a boss through its seam alone: nothing in src/bot imports a particular boss', () => {
    for (const file of readdirSync(BOT_DIR)) {
      const source = readFileSync(new URL(file, BOT_DIR), 'utf8');
      for (const [, module] of source.matchAll(/from '\.\.\/sim\/boss\/(\w+)'/g)) expect(GENERIC_BOSS_MODULES, `${file} imports sim/boss/${String(module)}`).toContain(module);
      expect(source, file).not.toMatch(/'(shardRing|lunge|shardVolley|quake|pulse|launch|broadside|retreat)'/);
    }
  });

  it('shows the attack winding up or running, with its windup and declared threat, and nothing between attacks', () => {
    const { runner, arena } = fight('sentinel');
    expect(runner.view.threat).toBeNull();
    const threats: (BossThreat | null)[] = [];
    runFor((dt, a) => { runner.step(dt, a); }, arena, 6, () => {
      const { windup, active, threat } = runner.view;
      if (windup === null && active === null) expect(threat).toBeNull();
      else {
        expect(threat?.attack).toBe(windup ?? active);
        threats.push(threat);
      }
    });
    expect(threats[0]).toEqual({ attack: 'shardRing', windup: 0.6, kind: 'none', reach: 0, speed: 0 });
  });

  it.each<{ id: BossId; attack: AttackId; phase: 1 | 2 | 3; threat: Omit<BossThreat, 'attack'> }>([
    { id: 'sentinel', attack: 'lunge', phase: 2, threat: { windup: 0.5, kind: 'lane', reach: BOSSES.sentinel.radius, speed: 0 } },
    { id: 'monolith', attack: 'shardVolley', phase: 1, threat: { windup: 1.2, kind: 'lane', reach: 46 + 15, speed: 0 } },
    { id: 'monolith', attack: 'pulse', phase: 3, threat: { windup: 0.5, kind: 'shove', reach: 320, speed: 260 } },
    { id: 'monolith', attack: 'quake', phase: 2, threat: { windup: 0.8, kind: 'none', reach: 0, speed: 0 } },
    { id: 'hiveCarrier', attack: 'launch', phase: 1, threat: { windup: 0.7, kind: 'none', reach: 0, speed: 0 } },
    { id: 'hiveCarrier', attack: 'retreat', phase: 2, threat: { windup: 1, kind: 'none', reach: 0, speed: 0 } },
  ])("resolves $id's $attack as the data its behaviour declares", ({ id, attack, phase, threat }) => {
    const { runner, arena } = fight(id);
    expect(windUpTo(runner, arena, attack, phase)).toEqual({ attack, ...threat });
  });

  it("predicts a declared shove exactly: the shove the pulse asks for is the threat's radial shove at the ship", () => {
    const arena = stubArena();
    const { runner } = fight('monolith', arena);
    const threat = windUpTo(runner, arena, 'pulse', 3);
    if (threat?.kind !== 'shove') throw new Error('the pulse declares no shove');
    while (runner.view.active !== 'pulse') tick(runner, arena);
    // Within its reach, off to one side, so the shove has both components.
    Object.assign(arena.ship, { x: runner.view.x + 120, y: runner.view.y + 150 });
    tick(runner, arena);
    const ctx = (runner as unknown as { context: AttackContext }).context;
    const expected = radialShove(runner.view, threat.speed, threat.reach, arena.ship.x, arena.ship.y, { x: 0, y: 0 });
    expect({ x: ctx.shoveX, y: ctx.shoveY }).toEqual(expected);
    expect(Math.hypot(expected.x, expected.y)).toBeGreaterThan(0);
  });

  it("tags the foes a boss launches as its attack's, and no other foe, even in a reused slot", () => {
    const arena = stubArena();
    const foes = new FoeField(arena, createRng(2), { score: (base) => base, killed: () => undefined });
    expect(foes.launch('drone', 100, 100, 0)).toBe(true);
    const [launched] = foes.list;
    expect(launched?.fromAttack).toBe(true);
    foes.clear();
    foes.spawn('drone', 3, 1);
    expect(foes.list.length).toBeGreaterThan(0);
    for (const foe of foes.list) expect(foe.fromAttack).toBe(false);
  });
});
