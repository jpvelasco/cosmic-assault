import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import type { BossId } from '../../src/content/types';
import type { AttackSpec, BossBehaviour, BossFactory, BossPart } from '../../src/sim/boss/behaviour';
import { bossClearance } from '../../src/sim/boss/bossRules';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { BOSS_BEHAVIOURS } from '../../src/sim/boss/roster';
import { BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import { FoeField } from '../../src/sim/foes/foeField';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import { BOSS_FIELD, runFor, stubArena, FIXTURE_DEF } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const SEGMENT_RADIUS = 24;
/** How far below its core the fake serpent's one segment trails. */
const TRAIL = 300;
const fieldAt = (aspect: number): Field => ({ width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT });

/**
 * A part-led fake boss: a core that keeps only its own radius from the walls, and one segment trailing `trail` below
 * it, far outside that radius, as a serpent's tail would.
 */
function serpent(trail = TRAIL, driftSpeed = 60): BossBehaviour {
  const segment: BossPart = { x: 0, y: 0, px: 0, py: 0, radius: SEGMENT_RADIUS, hp: 4, maxHp: 4 };
  const spec: AttackSpec = { windup: 0.5, active: 0, run: () => undefined };
  const place = (x: number, y: number): void => {
    segment.x = x;
    segment.y = y + trail;
  };
  return {
    driftSpeed,
    rigidParts: true,
    // Every attack the fixture's definition names, so it can stand in for any boss's.
    attacks: { quake: spec, dive: spec, shardVolley: spec, pulse: spec },
    parts: [segment],
    home: (field) => {
      const home = { x: field.width / 2, y: field.height * 0.28 };
      place(home.x, home.y);
      return home;
    },
    step: (ctx) => {
      place(ctx.boss.x, ctx.boss.y);
    },
  };
}

const setupFor = (field: Field, arena = stubArena(undefined, field)) => ({
  maxHp: 30,
  rng: createRng(3),
  rockSpeed: 1,
  field,
  foes: new FoeField(arena, createRng(2), { score: (b: number) => b, killed: () => undefined }),
  bolts: new Bolts(arena),
});

describe('part-aware boss reach', () => {
  it('measures clearance from the core\'s reach and from every live part by its own radius', () => {
    const behaviour = serpent();
    const runner = new BossRunner(FIXTURE_DEF, behaviour, setupFor(BOSS_FIELD));
    const { view } = runner;
    const segment = view.parts[0] as BossPart;
    expect(bossClearance(view, runner.reach, segment.x, segment.y + 30)).toBeCloseTo(30 - SEGMENT_RADIUS, 9);
    expect(bossClearance(view, runner.reach, view.x + 100, view.y)).toBeCloseTo(100 - runner.reach, 9);
    segment.hp = 0;
    expect(bossClearance(view, runner.reach, segment.x, segment.y)).toBeCloseTo(TRAIL - runner.reach, 9);
  });

  it.each([
    { label: '4:3', aspect: MIN_ASPECT },
    { label: '21:9', aspect: MAX_ASPECT },
  ])('keeps every body of every boss clear of a ship parked at the centre at $label, as it arrives and as its fight starts', ({ aspect }) => {
    const field = fieldAt(aspect);
    const [cx, cy] = [field.width / 2, field.height / 2];
    for (const id of Object.keys(BOSS_BEHAVIOURS) as BossId[]) {
      const arena = stubArena(createShip(cx, cy), field);
      const setup = setupFor(field, arena);
      const runner = new BossRunner(BOSSES[id], BOSS_BEHAVIOURS[id](setup), setup);
      expect(bossClearance(runner.view, runner.reach, cx, cy), `${id} as it arrives`).toBeGreaterThan(PLAYER.radius);
      // Its intro, then the first step of the fight: a boss that moves through its intro must still leave the spot clear.
      runFor((dt, a) => { if (runner.state === 'intro') runner.step(dt, a); }, arena, BOSS_INTRO_SECONDS + STEP_SECONDS);
      expect(runner.state, id).toBe('fighting');
      expect(bossClearance(runner.view, runner.reach, cx, cy), `${id} as its fight starts`).toBeGreaterThan(PLAYER.radius);
    }
    // The check sees a segment the core's reach does not: a serpent whose tail lies on the centre fails it.
    const tailOnCentre = new BossRunner(FIXTURE_DEF, serpent(field.height / 2 - field.height * 0.28), setupFor(field));
    expect(bossClearance(tailOnCentre.view, tailOnCentre.reach, field.width / 2, field.height / 2)).toBeLessThan(PLAYER.radius);
  });

  it('drifts the core so its far-trailing segment stays inside the field too', () => {
    const arena = stubArena();
    const runner = new BossRunner(FIXTURE_DEF, serpent(), setupFor(BOSS_FIELD));
    let lowest = 0;
    runFor((dt, a) => {
      runner.step(dt, a);
      const segment = runner.view.parts[0] as BossPart;
      lowest = Math.max(lowest, segment.y + segment.radius);
      expect(segment.y + segment.radius, `segment at ${String(segment.y)}`).toBeLessThanOrEqual(BOSS_FIELD.height + 1e-6);
    }, arena, 60);
    expect(lowest).toBeGreaterThan(BOSS_FIELD.height - 40);
  });

  it('leaves the core of a boss whose parts trail behind it on its own path: a segment outside the field never shoves it', () => {
    const LAG_STEPS = 20;
    const spec: AttackSpec = { windup: 0.5, active: 0, run: () => undefined };
    /** A drifting core whose one segment copies where the core was `LAG_STEPS` steps of the fight before, or none. */
    const trailing = (withSegment: boolean): BossBehaviour => {
      // It starts 5 units past the bottom wall, below a core at home, and stays there until the fight has run its lag.
      const segment: BossPart = { x: 640, y: BOSS_FIELD.height + 5 - SEGMENT_RADIUS, px: 0, py: 0, radius: SEGMENT_RADIUS, hp: 4, maxHp: 4 };
      const xs: number[] = [];
      const ys: number[] = [];
      return {
        driftSpeed: 60,
        attacks: { quake: spec, dive: spec },
        parts: withSegment ? [segment] : [],
        step: (ctx) => {
          if (ctx.boss.state !== 'fighting') return;
          xs.push(ctx.boss.x);
          ys.push(ctx.boss.y);
          if (xs.length <= LAG_STEPS) return;
          segment.x = xs[xs.length - 1 - LAG_STEPS] ?? 0;
          segment.y = ys[ys.length - 1 - LAG_STEPS] ?? 0;
        },
      };
    };
    const paths = [true, false].map((withSegment) => {
      const runner = new BossRunner(FIXTURE_DEF, trailing(withSegment), setupFor(BOSS_FIELD));
      const path: number[] = [];
      runFor((dt, a) => {
        runner.step(dt, a);
        path.push(runner.view.x, runner.view.y);
      }, stubArena(), 6);
      return path;
    });
    expect(paths[0]).toEqual(paths[1]);
  });

  it('refuses, naming the boss, rigid parts that reach further than the field holds, but leaves trailing ones to their boss', () => {
    const spec: AttackSpec = { windup: 0.5, active: 0, run: () => undefined };
    const at = (dy: number): BossPart => ({ x: 640, y: 201.6 + dy, px: 0, py: 0, radius: SEGMENT_RADIUS, hp: 4, maxHp: 4 });
    // 380 above and below the core, and their radii: 808 down, in a field 720 high.
    const tall = (rigidParts: boolean): BossBehaviour => ({ driftSpeed: 0, rigidParts, attacks: { quake: spec, dive: spec }, parts: [at(-380), at(380)] });
    expect(() => new BossRunner(FIXTURE_DEF, tall(true), setupFor(BOSS_FIELD))).toThrow(/^monolith reaches .*808 down.*720 field.*shrink its reach, its orbit or its parts' radius/);
    expect(() => new BossRunner(FIXTURE_DEF, tall(false), setupFor(BOSS_FIELD))).not.toThrow();
  });

  it('respawns a ship clear of a segment that lies across the usual spot, not only clear of the core', () => {
    const arena = stubArena();
    const galaxy = { ...galaxyById('1-6'), kinds: MUTED_KINDS, events: [] };
    const serpents = Object.fromEntries(Object.keys(BOSSES).map((id) => [id, () => serpent(TRAIL, 0)])) as unknown as Record<BossId, BossFactory>;
    const run = new GalaxyRun(galaxy, 'free', { director: createRng(1), boss: createRng(2), pickups: createRng(3), foes: createRng(4), hazards: () => createRng(5) }, arena, 0, serpents);
    for (let i = 0; i < Math.round(22.1 / STEP_SECONDS); i++) {
      arena.tick();
      run.beginStep();
      run.step(STEP_SECONDS);
    }
    const boss = run.boss;
    if (boss === null) throw new Error('the serpent should be fighting');
    const segment = boss.parts[0] as BossPart;
    // The usual spot, low in the middle, sits on the segment.
    expect(Math.hypot(BOSS_FIELD.width / 2 - segment.x, BOSS_FIELD.height * 0.8 - segment.y)).toBeLessThan(SEGMENT_RADIUS + ASTEROID.safeRadius);
    const spot = run.respawnPoint();
    if (spot === null) throw new Error('no respawn spot');
    expect(bossClearance(boss, run.bosses.runner?.reach ?? 0, spot.x, spot.y)).toBeGreaterThanOrEqual(PLAYER.radius + ASTEROID.safeRadius);
  });
});
