import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/content/bosses';
import { galaxyById } from '../../src/content/galaxies';
import type { BossId } from '../../src/content/types';
import type { AttackSpec, BossBehaviour, BossFactory, BossPart } from '../../src/sim/boss/behaviour';
import { bossClearance } from '../../src/sim/boss/bossRules';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { BOSS_BEHAVIOURS } from '../../src/sim/boss/roster';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import { FoeField } from '../../src/sim/foes/foeField';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { createRng } from '../../src/sim/rng';
import { BOSS_FIELD, runFor, stubArena } from '../helpers/bossArena';
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
    // Every attack the 1-★ and Sentinel definitions name, so it can stand in for either.
    attacks: { shardRing: spec, lunge: spec, shardVolley: spec, quake: spec, pulse: spec },
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

const setupFor = (field: Field) => {
  const arena = stubArena(undefined, field);
  return { maxHp: 30, rng: createRng(3), rockSpeed: 1, field, foes: new FoeField(arena, createRng(2), { score: (b) => b, killed: () => undefined }), bolts: new Bolts(arena) };
};

describe('part-aware boss reach', () => {
  it('measures clearance from the core\'s reach and from every live part by its own radius', () => {
    const behaviour = serpent();
    const runner = new BossRunner(BOSSES.sentinel, behaviour, setupFor(BOSS_FIELD));
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
  ])('keeps every body of every boss, as it arrives, clear of a ship parked at the centre at $label', ({ aspect }) => {
    const field = fieldAt(aspect);
    for (const id of Object.keys(BOSS_BEHAVIOURS) as BossId[]) {
      const setup = setupFor(field);
      const runner = new BossRunner(BOSSES[id], BOSS_BEHAVIOURS[id](setup), setup);
      expect(bossClearance(runner.view, runner.reach, field.width / 2, field.height / 2), id).toBeGreaterThan(PLAYER.radius);
    }
    // The check sees a segment the core's reach does not: a serpent whose tail lies on the centre fails it.
    const tailOnCentre = new BossRunner(BOSSES.sentinel, serpent(field.height / 2 - field.height * 0.28), setupFor(field));
    expect(bossClearance(tailOnCentre.view, tailOnCentre.reach, field.width / 2, field.height / 2)).toBeLessThan(PLAYER.radius);
  });

  it('drifts the core so its far-trailing segment stays inside the field too', () => {
    const arena = stubArena();
    const runner = new BossRunner(BOSSES.sentinel, serpent(), setupFor(BOSS_FIELD));
    let lowest = 0;
    runFor((dt, a) => {
      runner.step(dt, a);
      const segment = runner.view.parts[0] as BossPart;
      lowest = Math.max(lowest, segment.y + segment.radius);
      expect(segment.y + segment.radius, `segment at ${String(segment.y)}`).toBeLessThanOrEqual(BOSS_FIELD.height + 1e-6);
    }, arena, 60);
    expect(lowest).toBeGreaterThan(BOSS_FIELD.height - 40);
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
