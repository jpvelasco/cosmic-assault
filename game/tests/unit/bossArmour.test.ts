import { describe, expect, it } from 'vitest';
import { BOSSES, type BossDef } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import type { BossId } from '../../src/content/types';
import type { AttackSpec, BossBehaviour, BossFactory, BossPart, BossView } from '../../src/sim/boss/behaviour';
import { bossTarget, BossRunner } from '../../src/sim/boss/bossRunner';
import { STEP_SECONDS } from '../../src/sim/config';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, ofType, runFor, stubArena, timedOfType, type StubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const PARTS = 4;
const PART_RADIUS = 12;
/** How far apart along the row below the core its parts sit. */
const PART_SPACING = 60;
const BREAK_DAMAGE = 6;
const DEF: BossDef = { ...BOSSES.sentinel, partBreakDamage: BREAK_DAMAGE };

const live = (boss: Readonly<BossView>): number => boss.parts.filter((p) => p.hp > 0).length;

/**
 * A boss with a tail of four 2 HP parts in a row below its core. Only the tail-most live part can be hurt, the others
 * deflect; its core is shielded until every part is broken.
 */
function segmented(): BossBehaviour {
  const parts: BossPart[] = Array.from({ length: PARTS }, () => ({ x: 0, y: 0, px: 0, py: 0, radius: PART_RADIUS, hp: 2, maxHp: 2 }));
  const spec: AttackSpec = { windup: 0.4, active: 0, run: () => undefined };
  const tail = (): number => parts.findLastIndex((p) => p.hp > 0);
  return {
    driftSpeed: 0,
    attacks: { shardRing: spec, lunge: spec, shardVolley: spec, quake: spec, pulse: spec },
    parts,
    reach: 70,
    step: (ctx) => {
      parts.forEach((part, i) => {
        part.x = ctx.boss.x + (i - (PARTS - 1) / 2) * PART_SPACING;
        part.y = ctx.boss.y + 140;
      });
    },
    vulnerable: (boss) => live(boss) === 0,
    partVulnerable: (index) => index === tail(),
  };
}

function fighting(def: BossDef = DEF, maxHp = 30, arena: StubArena = stubArena()): { r: BossRunner; arena: StubArena } {
  const r = new BossRunner(def, segmented(), { maxHp, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD });
  runFor((dt, a) => { r.step(dt, a); }, arena, 2.05);
  expect(r.state).toBe('fighting');
  return { r, arena };
}

describe('armoured boss parts', () => {
  it('deflect a blow on a part its behaviour armours, which keeps its HP, and take one on the part it leaves open', () => {
    const { r } = fighting();
    expect(r.hitPart(0, 1)).toBe('deflected');
    expect(r.view.parts[0]?.hp).toBe(2);
    expect(r.hitPart(3, 1)).toBe('hit');
    expect(r.hitPart(3, 1)).toBe('broken');
    // The tail has moved up the row: part 2 is open now.
    expect(r.hitPart(2, 1)).toBe('hit');
  });

  it('show which live parts are armoured on the view, refreshed as the tail moves', () => {
    const { r } = fighting();
    expect(r.view.parts.map((p) => p.armoured)).toEqual([true, true, true, false]);
    while ((r.view.parts[3]?.hp ?? 0) > 0) r.hitPart(3, 1);
    expect(r.view.parts.slice(0, 3).map((p) => p.armoured)).toEqual([true, true, false]);
  });

  it('leave bossTarget on the first live part a shot can hurt, not the first live part', () => {
    const { r } = fighting();
    expect(bossTarget(r.view)).toBe(r.view.parts[3]);
    while ((r.view.parts[3]?.hp ?? 0) > 0) r.hitPart(3, 1);
    expect(bossTarget(r.view)).toBe(r.view.parts[2]);
  });

  it('mark no part armoured for a behaviour that armours none', () => {
    const behaviour = { ...segmented() };
    delete (behaviour as { partVulnerable?: unknown }).partVulnerable;
    const r = new BossRunner(DEF, behaviour, { maxHp: 30, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD });
    expect(r.view.parts.map((p) => p.armoured)).toEqual([false, false, false, false]);
    expect(bossTarget({ ...r.view, state: 'fighting' })).toBe(r.view.parts[0]);
  });
});

describe('part break damage (M6-R9)', () => {
  it('takes the definition\'s break damage off the core with each part broken, though the core is shielded', () => {
    const { r } = fighting();
    expect(r.view.vulnerable).toBe(false);
    while ((r.view.parts[3]?.hp ?? 0) > 0) r.hitPart(3, 1);
    expect(r.hp).toBe(30 - BREAK_DAMAGE);
  });

  it('can move the boss to its next phase, announced on the next step', () => {
    const { r, arena } = fighting();
    const log = runFor((dt, a) => {
      const tail = r.view.parts.findLastIndex((p) => p.hp > 0);
      if (tail >= 0 && a.elapsed() > 3) r.hitPart(tail, 2);
      r.step(dt, a);
    }, arena, 2);
    expect(r.hp).toBe(30 - PARTS * BREAK_DAMAGE);
    expect(timedOfType(log, 'bossPhase').map((l) => l.event.phase)).toEqual([2, 3]);
  });

  it('never kills: a break that would empty the core leaves it 1 HP, fighting', () => {
    const { r } = fighting(DEF, 8);
    for (let i = PARTS - 1; i >= 0; i--) while ((r.view.parts[i]?.hp ?? 0) > 0) r.hitPart(i, 1);
    expect(r.hp).toBe(1);
    expect(r.state).toBe('fighting');
    expect(r.hit(1)).toBe('killed');
  });

  it('is nothing for a boss whose definition gives none', () => {
    const { r } = fighting(BOSSES.sentinel);
    while ((r.view.parts[3]?.hp ?? 0) > 0) r.hitPart(3, 1);
    expect(r.hp).toBe(30);
  });
});

describe('a galaxy run whose boss has armoured parts', () => {
  const segments = (): Readonly<Record<BossId, BossFactory>> => Object.fromEntries(Object.keys(BOSSES).map((id) => [id, segmented])) as unknown as Record<BossId, BossFactory>;

  function galaxyRun() {
    const arena = stubArena();
    const galaxy = { ...galaxyById('1-6'), kinds: MUTED_KINDS, events: [] };
    const run = new GalaxyRun(galaxy, 'free', { director: createRng(1), boss: createRng(2), pickups: createRng(3), foes: createRng(4), hazards: () => createRng(5) }, arena, 0, segments());
    for (let i = 0; i < Math.round(22.1 / STEP_SECONDS); i++) {
      arena.events.length = 0;
      arena.tick();
      run.beginStep();
      run.step(STEP_SECONDS);
    }
    arena.events.length = 0;
    const boss = run.boss;
    if (boss?.state !== 'fighting') throw new Error('the segmented boss should be fighting 22.1 s in');
    return { arena, run, boss };
  }

  it('spends a shot on an armoured part, reporting bossDeflected where it struck, and hurts the open one', () => {
    const { arena, run, boss } = galaxyRun();
    const [head, , , tail] = boss.parts as [BossPart, BossPart, BossPart, BossPart];
    expect(run.bosses.hitBoss(head.x + 2, head.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossDeflected', x: head.x + 2, y: head.y }]);
    expect(head.hp).toBe(2);
    arena.events.length = 0;
    expect(run.bosses.hitBoss(tail.x, tail.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossPartHit', part: 3, x: tail.x, y: tail.y, hp: 1 }]);
  });

  it('lets a blast hurt only the open parts in its reach, silently passing the armoured ones', () => {
    const { arena, run, boss } = galaxyRun();
    Object.assign(arena.ship, { x: boss.x, y: boss.y + 140 });
    run['takePickup']('nova');
    expect(boss.parts.map((p) => p.hp)).toEqual([2, 2, 2, 0]);
    expect(ofType(arena.events, 'bossDeflected')).toEqual([]);
    expect(ofType(arena.events, 'bossPartBroken').map((e) => e.part)).toEqual([3]);
  });
});
