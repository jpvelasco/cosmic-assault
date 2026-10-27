import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyDef, GalaxyId } from '../../src/content/types';
import type { BossPart } from '../../src/sim/boss/behaviour';
import { bossClearance, clearSpot, RESPAWN_INSET, RESPAWN_LOWEST_SHARE } from '../../src/sim/boss/bossRules';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { Field } from '../../src/sim/field';
import { GalaxyRun } from '../../src/sim/galaxy/galaxyRun';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { BOSS_FIELD, stubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const NARROW: Field = { width: 960, height: 720 };
/** The Monolith's reach (orbit 118 + shard 15), plus the ship and the safe margin. */
const MONOLITH_CLEARANCE = 133 + PLAYER.radius + ASTEROID.safeRadius;

function inside(spot: { x: number; y: number }, field: Field): boolean {
  return spot.x >= RESPAWN_INSET && spot.x <= field.width - RESPAWN_INSET && spot.y >= RESPAWN_INSET && spot.y <= field.height * RESPAWN_LOWEST_SHARE;
}

const calm = (id: GalaxyId): GalaxyDef => ({ ...galaxyById(id), kinds: MUTED_KINDS, events: [] });

describe('clearSpot', () => {
  it.each([
    ['at home', { x: 640, y: 201.6 }, BOSS_FIELD],
    ['at the centre', { x: 640, y: 360 }, BOSS_FIELD],
    ['at the centre of a narrow field', { x: 480, y: 360 }, NARROW],
    ['at the bottom of its drift', { x: 640, y: 587 }, BOSS_FIELD],
    ['in a bottom corner', { x: 1147, y: 587 }, BOSS_FIELD],
  ] as const)('puts the ship clear of a core %s, inside the field', (_name, core, field) => {
    const spot = clearSpot(core, MONOLITH_CLEARANCE, field);
    expect(Math.hypot(spot.x - core.x, spot.y - core.y)).toBeGreaterThanOrEqual(MONOLITH_CLEARANCE);
    expect(inside(spot, field)).toBe(true);
  });

  it('prefers low in the middle, no lower than 0.8 of the height, and otherwise goes as far from the core as the field allows', () => {
    expect(RESPAWN_LOWEST_SHARE).toBe(0.8);
    expect(clearSpot({ x: 640, y: 201.6 }, MONOLITH_CLEARANCE, BOSS_FIELD)).toEqual({ x: 640, y: BOSS_FIELD.height * 0.8 });
    expect(clearSpot({ x: 700, y: 587 }, MONOLITH_CLEARANCE, BOSS_FIELD)).toEqual({ x: RESPAWN_INSET, y: RESPAWN_INSET });
  });
});

describe('clearSpot with its usual spots blocked', () => {
  const MARGIN = PLAYER.radius + ASTEROID.safeRadius;
  /** One part on each of the five usual spots of a small core at (640, 300). */
  const blocker = (): { x: number; y: number; parts: BossPart[] } => {
    const [left, right, top, bottom] = [RESPAWN_INSET, BOSS_FIELD.width - RESPAWN_INSET, RESPAWN_INSET, BOSS_FIELD.height * RESPAWN_LOWEST_SHARE];
    const spots = [[640, bottom], [left, top], [right, top], [left, bottom], [right, bottom]] as const;
    return { x: 640, y: 300, parts: spots.map(([x, y]) => ({ x, y, px: x, py: y, radius: 40, hp: 1, maxHp: 1 })) };
  };

  it('searches a grid across the respawn band for a spot clear of every part, the same one every time', () => {
    const boss = blocker();
    const spot = clearSpot(boss, 10, BOSS_FIELD, MARGIN);
    expect(bossClearance(boss, 10, spot.x, spot.y)).toBeGreaterThanOrEqual(MARGIN);
    expect(inside(spot, BOSS_FIELD)).toBe(true);
    expect(clearSpot(boss, 10, BOSS_FIELD, MARGIN)).toEqual(spot);
  });

  it('with nowhere clear, takes the clearest spot of all: the far corner from a core whose reach covers the field', () => {
    const boss = { x: 300, y: 200 };
    expect(clearSpot(boss, 5000, BOSS_FIELD, MARGIN)).toEqual({ x: BOSS_FIELD.width - RESPAWN_INSET, y: BOSS_FIELD.height * RESPAWN_LOWEST_SHARE });
  });
});

describe('respawning in a boss galaxy', () => {
  function fightingRun() {
    const arena = stubArena();
    const run = new GalaxyRun(calm('1-6'), 'free', { director: createRng(1), boss: createRng(2), pickups: createRng(3), foes: createRng(4), hazards: () => createRng(5) }, arena);
    for (let i = 0; i < Math.round(22.1 / STEP_SECONDS); i++) {
      arena.tick();
      run.beginStep();
      run.step(STEP_SECONDS);
      arena.events.length = 0;
    }
    const boss = run.boss;
    if (boss === null) throw new Error('the Monolith should be fighting 22.1 s in');
    return { run, boss };
  }

  it.each([
    ['at the centre', 640, 360],
    ['at the bottom of its drift', 640, 587],
  ] as const)('puts a respawned ship clear of a core parked %s', (_name, x, y) => {
    const { run, boss } = fightingRun();
    Object.assign(boss, { x, y, px: x, py: y });
    const spot = run.respawnPoint();
    if (spot === null) throw new Error('a fighting boss should move the respawn');
    expect(Math.hypot(spot.x - x, spot.y - y)).toBeGreaterThanOrEqual(MONOLITH_CLEARANCE);
    expect(inside(spot, BOSS_FIELD)).toBe(true);
  });

  it('respawns an idle ship hit by the Monolith clear of it, and a survival galaxy\'s at the centre', () => {
    const world = new World({ seed: 1, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calm('1-6'), mode: 'free' } });
    let respawns = 0;
    for (let i = 0; i < Math.round(80 / STEP_SECONDS) && world.status === 'playing'; i++) {
      if (!world.step(STEP_SECONDS, NO_CONTROLS).some((e) => e.type === 'shipHit') || world.lives === 0) continue;
      const boss = world.boss;
      if (boss === null) throw new Error('only the Monolith hits the ship here');
      expect(Math.hypot(world.ship.x - boss.x, world.ship.y - boss.y)).toBeGreaterThanOrEqual(MONOLITH_CLEARANCE);
      respawns++;
    }
    expect(respawns).toBeGreaterThanOrEqual(1);

    const survival = new World({ seed: 1, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calm('1-5'), mode: 'free' }, initialAsteroids: [{ x: 640, y: 360, size: 0, angle: 0, speedMultiplier: 0 }] });
    survival.step(STEP_SECONDS, NO_CONTROLS);
    for (let i = 0; i < Math.round(4 / STEP_SECONDS) && survival.lives === 3; i++) survival.step(STEP_SECONDS, NO_CONTROLS);
    expect(survival.lives).toBe(2);
    expect({ x: survival.ship.x, y: survival.ship.y }).toEqual({ x: 640, y: 360 });
  });
});
