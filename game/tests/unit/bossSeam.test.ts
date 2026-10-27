import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/content/bosses';
import { FOES } from '../../src/content/foes';
import { galaxyById } from '../../src/content/galaxies';
import type { BossId } from '../../src/content/types';
import { bossTarget } from '../../src/sim/boss/bossRules';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import type { AttackSpec, BossBehaviour, BossFactory, BossSetup, BossView } from '../../src/sim/boss/behaviour';
import { STEP_SECONDS } from '../../src/sim/config';
import { FOE_CAPACITY, FoeField } from '../../src/sim/foes/foeField';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const DEF = BOSSES.sentinel;
const INTRO = 2;
/** The probe's weak point: the half of its rim facing right, and only while it says its door is open. */
const WEAK_SIDE = 1;

const stepper = (r: BossRunner) => (dt: number, arena: StubArena) => {
  r.step(dt, arena);
};

interface DoorProbe extends BossBehaviour {
  /** Whether its door is open; the probe's core can be hurt only then. */
  open: boolean;
  /** Every point `hurtsAt` was asked about. */
  readonly asked: { x: number; y: number }[];
}

/** A boss hurt only through the right half of its rim, and only while its door is open, aiming shots at that rim. */
function doorProbe(): DoorProbe {
  const spec: AttackSpec = { windup: 0.4, active: 0, run: () => undefined };
  const aim = { x: 0, y: 0 };
  const asked: { x: number; y: number }[] = [];
  const probe: DoorProbe = {
    driftSpeed: 0,
    attacks: { shardRing: spec, lunge: spec },
    exposure: { opened: 'hangarOpen', closed: 'hangarClose' },
    open: false,
    asked,
    vulnerable: () => probe.open,
    hurtsAt: (boss, x, y) => {
      asked.push({ x, y });
      return Math.sign(x - boss.x) === WEAK_SIDE;
    },
    target: (boss) => {
      if (!boss.vulnerable) return null;
      aim.x = boss.x + boss.radius * WEAK_SIDE;
      aim.y = boss.y;
      return aim;
    },
  };
  return probe;
}

function runnerOf(behaviour: BossBehaviour): BossRunner {
  return new BossRunner(DEF, behaviour, { maxHp: 30, rng: createRng(1), rockSpeed: 1, field: BOSS_FIELD });
}

function fighting(behaviour: BossBehaviour): { r: BossRunner; arena: StubArena } {
  const r = runnerOf(behaviour);
  const arena = stubArena();
  runFor(stepper(r), arena, INTRO + 0.05);
  expect(r.state).toBe('fighting');
  return { r, arena };
}

describe('a boss hurt only at a weak point', () => {
  it('asks its behaviour about the point each blow lands on, and deflects a blow anywhere else', () => {
    const probe = doorProbe();
    const { r, arena } = fighting(probe);
    probe.open = true;
    runFor(stepper(r), arena, STEP_SECONDS);
    const { x, y, radius } = r.view;
    expect(r.hit(1, x - radius, y)).toBe('deflected');
    expect(r.hit(1, x + radius, y)).toBe('hit');
    expect(probe.asked).toEqual([{ x: x - radius, y }, { x: x + radius, y }]);
    expect(r.hp).toBe(29);
  });

  it('deflects every blow while its core is shielded, wherever it lands, without asking', () => {
    const probe = doorProbe();
    const { r } = fighting(probe);
    expect(r.view.vulnerable).toBe(false);
    expect(r.hit(1, r.view.x + r.view.radius, r.view.y)).toBe('deflected');
    expect(probe.asked).toEqual([]);
  });

  it('takes a blow given no point as landing on the core\'s centre', () => {
    const probe = doorProbe();
    const { r, arena } = fighting(probe);
    probe.open = true;
    runFor(stepper(r), arena, STEP_SECONDS);
    expect(r.hit(1)).toBe('deflected');
    expect(probe.asked).toEqual([{ x: r.view.x, y: r.view.y }]);
  });

  it('points a shot where its behaviour says, nowhere when it says so, and nowhere outside the fight', () => {
    const probe = doorProbe();
    const r = runnerOf(probe);
    const arena = stubArena();
    probe.open = true;
    runFor(stepper(r), arena, 0.5);
    expect(bossTarget(r.view)).toBeNull();
    runFor(stepper(r), arena, INTRO);
    expect(bossTarget(r.view)).toEqual({ x: r.view.x + r.view.radius, y: r.view.y });
    probe.open = false;
    runFor(stepper(r), arena, STEP_SECONDS);
    expect(bossTarget(r.view)).toBeNull();
  });

  it('announces its weak point opening and closing with its own events, never the core\'s', () => {
    const probe = doorProbe();
    const { r, arena } = fighting(probe);
    probe.open = true;
    const opened = runFor(stepper(r), arena, 0.5);
    probe.open = false;
    const closed = runFor(stepper(r), arena, 0.5);
    const { x, y } = r.view;
    expect(timedOfType(opened, 'hangarOpen').map((l) => l.event)).toEqual([{ type: 'hangarOpen', x, y }]);
    expect(timedOfType(closed, 'hangarClose').map((l) => l.event)).toEqual([{ type: 'hangarClose', x, y }]);
    expect([...opened, ...closed].filter((l) => l.event.type === 'bossExposed' || l.event.type === 'bossShielded')).toEqual([]);
  });

  it('faces down the field until its behaviour turns it', () => {
    const r = runnerOf(doorProbe());
    expect(r.view.facing).toBe(Math.PI / 2);
    runFor(stepper(r), stubArena(), INTRO + 1);
    expect(r.view.facing).toBe(Math.PI / 2);
  });
});

describe('a galaxy run with a boss that has a weak point and launches foes', () => {
  /** Every boss played by `make`, which also sees the setup each fight is made from. */
  function standIns(make: (setup: BossSetup) => BossBehaviour): Readonly<Record<BossId, BossFactory>> {
    return Object.fromEntries(Object.keys(BOSSES).map((id) => [id, make])) as unknown as Record<BossId, BossFactory>;
  }

  /** A 1-6 run whose boss, the Sentinel by its definition, is `make`'s, on a stub arena, stepped until the boss is fighting. */
  function fight(make: (setup: BossSetup) => BossBehaviour): { arena: StubArena; run: GalaxyRun; boss: BossView } {
    const arena = stubArena();
    const galaxy = { ...galaxyById('1-6'), kinds: MUTED_KINDS, events: [], boss: 'sentinel' as const };
    const run = new GalaxyRun(galaxy, 'free', { director: createRng(1), boss: createRng(2), pickups: createRng(3), foes: createRng(4), hazards: () => createRng(5) }, arena, 0, standIns(make));
    for (let i = 0; i < Math.round(22.1 / STEP_SECONDS); i++) {
      arena.events.length = 0;
      arena.tick();
      run.beginStep();
      run.step(STEP_SECONDS);
    }
    arena.events.length = 0;
    const boss = run.boss;
    if (boss?.state !== 'fighting') throw new Error('the boss should be fighting 22 s into 1-6');
    return { arena, run, boss };
  }

  it('lands each shot at its own point: the hull deflects it with a spark there, the weak point takes the hit', () => {
    const probe = doorProbe();
    probe.open = true;
    const { arena, run, boss } = fight(() => probe);
    run.step(STEP_SECONDS);
    arena.events.length = 0;
    const hull = { x: boss.x - boss.radius, y: boss.y };
    expect(run.bosses.hitBoss(hull.x, hull.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossDeflected', ...hull }]);
    arena.events.length = 0;
    expect(run.bosses.hitBoss(boss.x + boss.radius, boss.y, 3)).toBe(true);
    expect(arena.events).toEqual([{ type: 'bossHit', x: boss.x + boss.radius, y: boss.y, hp: boss.maxHp - 1 }]);
  });

  it('hands the fight the galaxy\'s foes, which a boss launches its own into and counts', () => {
    let foes: BossSetup['foes'];
    const { arena, run } = fight((setup) => {
      foes = setup.foes;
      return doorProbe();
    });
    if (foes === undefined) throw new Error('GalaxyRun should hand a boss its foes');
    expect(foes.launch('drone', 300, 250, 0)).toBe(true);
    expect(foes.launched).toBe(1);
    expect(run.foeList).toHaveLength(1);
    expect(run.foeList[0]).toMatchObject({ kind: 'drone', x: 300, y: 250, rotation: 0, vx: FOES.drone.speed, vy: 0 });
    expect(arena.events).toEqual([expect.objectContaining({ type: 'foeSpawned', kind: 'drone', x: 300, y: 250 })]);
  });
});

describe('FoeField launching a boss\'s foes', () => {
  function field(seed = 4): { arena: StubArena; foes: FoeField } {
    const arena = stubArena();
    return { arena, foes: new FoeField(arena, createRng(seed), { score: (base) => base, killed: () => undefined }) };
  }

  it('puts a foe where the boss says, heading where it says at its own speed, without drawing from the foes stream', () => {
    const { foes } = field();
    expect(foes.launch('drone', 400, 300, Math.PI / 2)).toBe(true);
    const [drone] = foes.list;
    expect(drone).toMatchObject({ kind: 'drone', x: 400, y: 300, px: 400, py: 300, rotation: Math.PI / 2, hp: 1 });
    expect(drone?.vx).toBeCloseTo(0, 9);
    expect(drone?.vy).toBeCloseTo(FOES.drone.speed, 9);
    expect(foes.rng.next()).toBe(createRng(4).next());
  });

  it('counts only the boss\'s own foes still alive, a kill or a ram taking one off and the warp all', () => {
    const { foes } = field();
    foes.spawn('drone', 3, 1);
    expect(foes.launched).toBe(0);
    foes.launch('drone', 400, 300, 0);
    foes.launch('drone', 500, 300, 0);
    expect(foes.launched).toBe(2);
    foes.step(STEP_SECONDS);
    expect(foes.hit(foes.list[3]?.x ?? 0, foes.list[3]?.y ?? 0, 1)).toBe(foes.list[3]?.id);
    foes.sweep();
    expect(foes.launched).toBe(1);
    foes.step(STEP_SECONDS);
    const left = foes.list[3];
    expect(foes.ram(left?.x ?? 0, left?.y ?? 0, 1)).toBe(true);
    foes.sweep();
    expect(foes.launched).toBe(0);
    foes.launch('drone', 400, 300, 0);
    foes.clear();
    expect(foes.launched).toBe(0);
  });

  it('launches nothing once the pool is full', () => {
    const { foes } = field();
    for (let i = 0; i < FOE_CAPACITY; i++) expect(foes.launch('drone', 10 * i, 300, 0)).toBe(true);
    expect(foes.launch('drone', 400, 300, 0)).toBe(false);
    expect(foes.launched).toBe(FOE_CAPACITY);
  });
});
