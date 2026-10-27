import { describe, expect, it } from 'vitest';
import type { AttackId } from '../../src/content/types';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import type { AttackSpec, BossBehaviour } from '../../src/sim/boss/behaviour';
import { STEP_SECONDS } from '../../src/sim/config';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, runFor, stubArena, timedOfType, type StubArena, type Timed, FIXTURE_DEF, FIXTURE } from '../helpers/bossArena';

const DEF = FIXTURE_DEF;
const MAX_HP = 30;
const INTRO = 2;
const DYING = 2;
const EPS = STEP_SECONDS * 2.5;

function runnerFor(behaviour: BossBehaviour = FIXTURE, maxHp = MAX_HP, seed = 1): BossRunner {
  return new BossRunner(DEF, behaviour, { maxHp, rng: createRng(seed), rockSpeed: 1, field: BOSS_FIELD });
}

const stepper = (r: BossRunner) => (dt: number, arena: StubArena) => {
  r.step(dt, arena);
};

/** A boss in `fighting`, with the intro played out. */
function fighting(maxHp = MAX_HP, behaviour: BossBehaviour = FIXTURE): { r: BossRunner; arena: StubArena } {
  const r = runnerFor(behaviour, maxHp);
  const arena = stubArena();
  runFor(stepper(r), arena, INTRO + 0.05);
  return { r, arena };
}

/** A behaviour whose attacks log `[time, age]` on every call, so windup and active time can be measured. */
function probe(windup: number, active: number, calls: (readonly [number, number])[] = []): BossBehaviour {
  const spec: AttackSpec = { windup, active, run: (ctx) => void calls.push([ctx.arena.elapsed(), ctx.age]) };
  return { attacks: { quake: spec, dive: spec }, driftSpeed: 0 };
}

describe('BossRunner intro and phases', () => {
  it('announces itself once and cannot be hurt for the 2 s intro', () => {
    const r = runnerFor();
    const arena = stubArena();
    const log = runFor(stepper(r), arena, INTRO - 0.1, () => {
      expect(r.state).toBe('intro');
      expect(r.hit(5)).toBe('blocked');
    });
    expect(timedOfType(log, 'bossIntro')).toEqual([{ at: STEP_SECONDS, event: { type: 'bossIntro', id: 'monolith' } }]);
    expect(r.hp).toBe(MAX_HP);
    runFor(stepper(r), arena, 0.2);
    expect(r.state).toBe('fighting');
    expect(r.hit(1)).toBe('hit');
    expect(r.hp).toBe(MAX_HP - 1);
  });

  it('changes phase exactly at two thirds and one third of its HP, announcing each once', () => {
    const { r, arena } = fighting(30);
    const log: Timed[] = [];
    const record = (): void => void log.push(...runFor(stepper(r), arena, STEP_SECONDS));
    const phases: number[] = [];
    for (let hp = 30; hp > 1; hp--) {
      r.hit(1);
      record();
      phases.push(r.phase);
      expect(r.hp).toBe(hp - 1);
    }
    // hp 29..21 -> 1, 20..11 -> 2, 10..1 -> 3
    expect(phases).toEqual([...Array<number>(9).fill(1), ...Array<number>(10).fill(2), ...Array<number>(10).fill(3)]);
    expect(timedOfType(log, 'bossPhase').map((l) => l.event.phase)).toEqual([2, 3]);
  });

  // 2/3 and 1/3 of 20 are 13.33 and 6.67; of 44 (Dimension 5), 29.33 and 14.67.
  it.each([
    [20, [14, 13, 7, 6]],
    [44, [30, 29, 15, 14]],
  ] as const)('puts the thresholds of a %i HP boss between %j', (maxHp, [phase1, phase2, phase2Low, phase3]) => {
    const phaseAt = (hp: number): number => {
      const { r } = fighting(maxHp);
      r.hit(maxHp - hp);
      return r.phase;
    };
    expect([phaseAt(phase1), phaseAt(phase2), phaseAt(phase2Low), phaseAt(phase3)]).toEqual([1, 2, 2, 3]);
  });

  it('announces every phase a single big blow skips over', () => {
    const { r, arena } = fighting(30);
    r.hit(25);
    const log = runFor(stepper(r), arena, STEP_SECONDS);
    expect(r.phase).toBe(3);
    expect(timedOfType(log, 'bossPhase').map((l) => l.event.phase)).toEqual([2, 3]);
  });

  it('rejects damage that is not a positive finite number, saying what to pass', () => {
    const { r } = fighting();
    for (const bad of [0, -1, Number.NaN, Infinity]) expect(() => r.hit(bad)).toThrow(/positive finite damage/);
  });
});

describe('BossRunner attacks', () => {
  it('runs the phase list in order and repeats it', () => {
    const { r, arena } = fighting();
    const first = runFor(stepper(r), arena, 20);
    expect(timedOfType(first, 'bossWindup').slice(0, 4).map((l) => l.event.attack)).toEqual(['quake', 'quake', 'quake', 'quake']);

    r.hit(10); // 20 of 30: phase 2
    const second = runFor(stepper(r), arena, 20);
    const phase2 = timedOfType(second, 'bossWindup').map((l) => l.event.attack);
    expect(phase2.slice(0, 5)).toEqual(['quake', 'dive', 'quake', 'dive', 'quake']);

    r.hit(10); // 10 of 30: phase 3
    const third = runFor(stepper(r), arena, 25);
    const phase3 = timedOfType(third, 'bossWindup').map((l) => l.event.attack);
    expect(phase3.slice(0, 6)).toEqual(['dive', 'quake', 'quake', 'dive', 'quake', 'quake']);
  });

  it('lets an attack under way finish when the phase changes, fires it at the new phase, then rests the new phase\'s time', () => {
    const { r, arena } = fighting();
    let hitDuringWindup = false;
    const ring = { at: -1, rocks: 0 };
    const log = runFor(stepper(r), arena, 9, () => {
      if (!hitDuringWindup && arena.events.some((e) => e.type === 'bossWindup')) {
        expect(r.hit(10)).toBe('hit');
        hitDuringWindup = true;
      }
      if (ring.at < 0 && arena.asteroids.length > 0) {
        ring.at = arena.elapsed();
        ring.rocks = arena.asteroids.length;
      }
    });
    const windups = timedOfType(log, 'bossWindup');
    expect(windups.map((w) => w.event.attack).slice(0, 3)).toEqual(['quake', 'quake', 'dive']);
    // The telegraphed ring was not cancelled: it fires once, with phase 2's 8 rocks.
    expect(ring.rocks).toBe(8);
    const [first, second] = [windups[0], windups[1]];
    expect(ring.at - (first?.at ?? 0)).toBeGreaterThanOrEqual(FIXTURE.attacks.quake.windup - EPS);
    // And the rest after it is phase 2's 1.6 s, not phase 1's 2.2 s.
    expect((second?.at ?? 0) - ring.at).toBeCloseTo(1.6, 1);
  });

  it('is deterministic: the same seed gives the same log, a different seed a different one', () => {
    const play = (seed: number): { log: unknown[]; rocks: unknown[] } => {
      const r = runnerFor(FIXTURE, MAX_HP, seed);
      const arena = stubArena();
      const log = runFor(stepper(r), arena, 30, () => {
        if (arena.elapsed() > 10 && arena.elapsed() < 10.05) r.hit(1);
      });
      return { log, rocks: arena.asteroids.map((a) => [a.id, a.x, a.y, a.vx, a.vy]) };
    };
    expect(play(3)).toEqual(play(3));
    expect(play(3)).not.toEqual(play(4));
  });

  it('shrinks the rest between attacks with each phase', () => {
    const rests: number[] = [];
    for (const phaseHp of [30, 20, 10]) {
      const { r, arena } = fighting(30, probe(0.4, 0.1));
      if (phaseHp < 30) r.hit(30 - phaseHp);
      const windups = timedOfType(runFor(stepper(r), arena, 12), 'bossWindup');
      const [a, b] = [windups[1], windups[2]];
      if (a === undefined || b === undefined) throw new Error('expected three attacks within 12 s');
      rests.push(b.at - a.at - 0.5);
    }
    DEF.rest.forEach((rest, i) => {
      expect(rests[i], `phase ${String(i + 1)}`).toBeCloseTo(rest, 1);
    });
    expect(rests[0]).toBeGreaterThan(rests[1] ?? 0);
    expect(rests[1]).toBeGreaterThan(rests[2] ?? 0);
  });

  it('gives every attack a telegraph of at least 0.35 s, and runs nothing during it', () => {
    for (const [id, spec] of Object.entries(FIXTURE.attacks)) expect(spec.windup, id).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
    const { r, arena } = fighting();
    const rocksAt: number[] = [];
    const log = runFor(stepper(r), arena, 12, () => rocksAt.push(arena.asteroids.length));
    const windups = timedOfType(log, 'bossWindup');
    const first = windups[0];
    if (first === undefined) throw new Error('expected an attack within 12 s');
    const startIndex = Math.round(first.at / STEP_SECONDS) - 1;
    const windupSteps = Math.round((first.event.attack === 'dive' ? FIXTURE.attacks.dive : FIXTURE.attacks.quake).windup / STEP_SECONDS);
    const before = rocksAt[startIndex - 1];
    for (let i = startIndex; i < startIndex + windupSteps - 1; i++) expect(rocksAt[i], `step ${String(i)}`).toBe(before);
    expect(rocksAt.at(-1)).toBeGreaterThan(before ?? 0);
  });

  it('runs an attack only once its windup is over, then for its active time', () => {
    const calls: (readonly [number, number])[] = [];
    const { r, arena } = fighting(30, probe(0.4, 0.1, calls));
    const windups = timedOfType(runFor(stepper(r), arena, 12), 'bossWindup');
    expect(windups.length).toBeGreaterThan(2);
    for (const { at } of windups) {
      const first = calls.find(([time]) => time > at);
      expect((first?.[0] ?? 0) - at).toBeGreaterThanOrEqual(0.4 - EPS);
    }
    const starts = calls.filter(([, age]) => age === 0).length;
    expect(starts).toBeGreaterThanOrEqual(windups.length - 1);
    // 0.1 s of active time is 12 steps of 1/120 s.
    expect(calls.length).toBeGreaterThanOrEqual(starts * 11);
    expect(calls.length).toBeLessThanOrEqual(starts * 13);
    expect(Math.max(...calls.map(([, age]) => age))).toBeLessThan(0.1);
  });

  it('refuses a behaviour whose windup is under 0.35 s, naming the attack', () => {
    expect(() => runnerFor(probe(0.2, 0.1))).toThrow(/windup .* 0\.35/);
  });

  it('exposes the attack being telegraphed on its view, and nothing outside a windup', () => {
    const { r, arena } = fighting();
    const seen = new Set<AttackId | null>();
    runFor(stepper(r), arena, 8, () => seen.add(r.view.windup));
    expect(seen).toEqual(new Set<AttackId | null>([null, 'quake']));
  });
});

describe('BossRunner death', () => {
  it('announces bossDown on its first dying step, then goes down silently after 2 s of invulnerable dying', () => {
    const { r, arena } = fighting(3);
    expect(r.hit(2)).toBe('hit');
    expect(r.hit(1)).toBe('killed');
    expect(r.hp).toBe(0);
    expect(r.state).toBe('dying');
    expect(r.hit(1)).toBe('blocked');
    const killedAt = arena.elapsed();
    const log = runFor(stepper(r), arena, DYING - 0.1, () => {
      expect(r.hit(1)).toBe('blocked');
    });
    expect(r.state).toBe('dying');
    const down = timedOfType(log, 'bossDown');
    expect(down.map((l) => l.event)).toEqual([{ type: 'bossDown', id: 'monolith' }]);
    expect(down[0]?.at).toBeCloseTo(killedAt + STEP_SECONDS, 9);
    const rest = runFor(stepper(r), arena, 0.2);
    expect(r.state).toBe('down');
    expect(rest).toEqual([]);
    expect(runFor(stepper(r), arena, 2)).toEqual([]);
    expect(r.hit(1)).toBe('blocked');
  });

  it('drops any attack under way, with no windup on show, when it dies', () => {
    const { r, arena } = fighting(2);
    const log: Timed[] = [];
    while (r.view.windup === null) log.push(...runFor(stepper(r), arena, STEP_SECONDS));
    r.hit(2);
    expect(r.view.windup).toBeNull();
    const before = arena.asteroids.length;
    runFor(stepper(r), arena, 4);
    expect(arena.asteroids.length).toBe(before);
  });
});

describe('BossRunner view', () => {
  it('is one object updated in place, with the previous pose for interpolation', () => {
    const r = runnerFor();
    const arena = stubArena();
    const view = r.view;
    expect(view).toMatchObject({ radius: DEF.radius, hp: MAX_HP, maxHp: MAX_HP, phase: 1, state: 'intro', windup: null });
    const moved: [number, number][] = [];
    runFor(stepper(r), arena, 8, () => {
      expect(r.view).toBe(view);
      if (view.state === 'fighting') moved.push([view.x - view.px, view.y - view.py]);
    });
    expect(moved.some(([dx, dy]) => dx !== 0 || dy !== 0)).toBe(true);
    expect(Math.max(...moved.map(([dx, dy]) => Math.hypot(dx, dy)))).toBeLessThan(5);
  });

  it('keeps its core inside the field however long it drifts', () => {
    const { r, arena } = fighting();
    runFor(stepper(r), arena, 60, () => {
      expect(r.view.x).toBeGreaterThanOrEqual(DEF.radius - EPS);
      expect(r.view.x).toBeLessThanOrEqual(BOSS_FIELD.width - DEF.radius + EPS);
      expect(r.view.y).toBeGreaterThanOrEqual(DEF.radius - EPS);
      expect(r.view.y).toBeLessThanOrEqual(BOSS_FIELD.height - DEF.radius + EPS);
    });
  });
});
