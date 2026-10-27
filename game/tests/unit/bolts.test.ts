import { describe, expect, it } from 'vitest';
import { BOLT } from '../../src/content/foes';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyDef } from '../../src/content/types';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { Bolts } from '../../src/sim/foes/bolts';
import { World } from '../../src/sim/world';
import { BOSS_FIELD, ofType, stubArena } from '../helpers/bossArena';
import { MUTED_KINDS } from '../helpers/mute';

const DT = STEP_SECONDS;

/** Steps `bolts` for `seconds` of fixed steps. */
function stepFor(bolts: Bolts, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) bolts.step(DT);
}

describe('hostile bolts', () => {
  it('are radius 5, fly at 230 by default and live 3.2 s, from a pool of 96', () => {
    expect(BOLT).toEqual({ radius: 5, speed: 230, life: 3.2, capacity: 96 });
  });

  it('fire from a point along a bearing at a speed, announced with boltFired, the bolt tagged with its source', () => {
    const arena = stubArena();
    const bolts = new Bolts(arena);
    const bolt = bolts.fire(300, 200, Math.PI / 2, BOLT.speed, 'boss');
    expect(bolt).not.toBeNull();
    expect(bolts.list).toEqual([bolt]);
    expect(bolt).toMatchObject({ x: 300, y: 200, px: 300, py: 200, radius: BOLT.radius, source: 'boss', fromAttack: false });
    expect(bolt?.vx).toBeCloseTo(0, 9);
    expect(bolt?.vy).toBeCloseTo(BOLT.speed, 9);
    expect(ofType(arena.events, 'boltFired')).toEqual([{ type: 'boltFired', id: bolt?.id, source: 'boss', x: 300, y: 200, angle: Math.PI / 2 }]);
    bolts.step(0.5);
    expect(bolt?.py).toBe(200);
    expect(bolt?.y).toBeCloseTo(200 + BOLT.speed * 0.5, 9);
  });

  it('holds at most 96: a bolt past that is not fired, and a spent one frees its slot for the next, the same object', () => {
    const arena = stubArena();
    const bolts = new Bolts(arena);
    const fired = Array.from({ length: BOLT.capacity }, () => bolts.fire(640, 360, 0, 0, 'boss'));
    expect(fired.every((b) => b !== null)).toBe(true);
    arena.events.length = 0;
    expect(bolts.fire(640, 360, 0, 0, 'boss')).toBeNull();
    expect(arena.events).toEqual([]);
    expect(bolts.list).toHaveLength(BOLT.capacity);
    expect(bolts.strikes(640, 360, 10)).toBe(true);
    const again = bolts.fire(100, 100, 1, 50, 'boss');
    expect(fired).toContain(again);
    expect(again).toMatchObject({ x: 100, y: 100, fromAttack: false });
  });

  it('pass out of the field instead of wrapping, and are gone once wholly outside it', () => {
    const bolts = new Bolts(stubArena());
    const bolt = bolts.fire(BOSS_FIELD.width - 20, 300, 0, BOLT.speed, 'boss');
    let furthest = 0;
    for (let i = 0; i < Math.round(1 / DT) && bolts.list.length > 0; i++) {
      bolts.step(DT);
      furthest = Math.max(furthest, bolt?.x ?? 0);
      expect(bolt?.x ?? 0).toBeGreaterThan(BOSS_FIELD.width - 20);
    }
    expect(bolts.list).toEqual([]);
    expect(furthest).toBeGreaterThan(BOSS_FIELD.width + BOLT.radius - BOLT.speed * DT);
  });

  it('expire after 3.2 s of their own time even if still on the field', () => {
    const bolts = new Bolts(stubArena());
    bolts.fire(640, 360, 0, 0, 'boss');
    stepFor(bolts, BOLT.life - 0.05);
    expect(bolts.list).toHaveLength(1);
    stepFor(bolts, 0.1);
    expect(bolts.list).toEqual([]);
  });

  it('strike a circle they overlap, spending the bolt that struck, and leave the rest', () => {
    const bolts = new Bolts(stubArena());
    bolts.fire(100, 100, 0, 0, 'boss');
    bolts.fire(400, 100, 0, 0, 'boss');
    expect(bolts.strikes(100 + 14, 100, 10)).toBe(true);
    expect(bolts.list.map((b) => b.x)).toEqual([400]);
    expect(bolts.strikes(100, 100, 10)).toBe(false);
  });

  it('are cleared within a circle, or all at once', () => {
    const bolts = new Bolts(stubArena());
    for (const x of [100, 200, 600]) bolts.fire(x, 100, 0, 0, 'boss');
    bolts.clearWithin(150, 100, 60);
    expect(bolts.list.map((b) => b.x)).toEqual([600]);
    bolts.clear();
    expect(bolts.list).toEqual([]);
  });
});

describe('bolts in a galaxy run', () => {
  const calm = (): GalaxyDef => ({ ...galaxyById('2-4'), kinds: MUTED_KINDS, events: [] });

  /** A calm galaxy with one bolt fired at (x, y) along +x, its ship at rest at the centre. */
  function withBolt(x: number, y: number, warp = false) {
    const world = new World({ seed: 3, field: BOSS_FIELD, rules: { kind: 'galaxy', galaxy: calm(), mode: 'free' } });
    const run = world['run'];
    if (run === null) throw new Error('not a galaxy');
    if (warp) run.loadout.collect('timeWarp');
    const bolt = run['bolts'].fire(x, y, 0, BOLT.speed, 'boss');
    if (bolt === null) throw new Error('no bolt');
    return { world, run, bolt };
  }

  it('fly at the enemies\' time scale: half as far a step under Time Warp', () => {
    const flown = (warp: boolean): number => {
      const { world, bolt } = withBolt(100, 100, warp);
      world.step(DT, NO_CONTROLS);
      return bolt.x - 100;
    };
    expect(flown(false)).toBeCloseTo(BOLT.speed * DT, 9);
    expect(flown(true)).toBeCloseTo(BOLT.speed * DT * 0.5, 9);
  });

  it('cost the ship a life when one strikes it once it can be hurt, spending the bolt', () => {
    const { world, run } = withBolt(0, 0);
    const { ship } = world;
    Object.assign(world['shipState'], { invulnerable: false, invulnerableFor: 0 });
    const bolt = run['bolts'].list[0];
    if (bolt === undefined) throw new Error('no bolt');
    Object.assign(bolt, { x: ship.x - 8, y: ship.y, vx: 0, vy: 0 });
    const events = world.step(DT, NO_CONTROLS);
    expect(ofType(events, 'shipHit')).toHaveLength(1);
    expect(run['bolts'].list).toEqual([]);
  });

  it('are swept by a blast and by the warp out', () => {
    const { world, run } = withBolt(640, 300);
    run['bolts'].fire(40, 40, 0, 0, 'boss');
    run['takePickup']('fieldBomb');
    expect(run['bolts'].list.map((b) => b.x)).toEqual([40]);
    for (let i = 0; i < Math.round((galaxyById('2-4').duration + 0.1) / DT) && world.status === 'playing'; i++) {
      run['bolts'].fire(40, 40, 0, 0, 'boss');
      Object.assign(world['shipState'], { invulnerable: true, invulnerableFor: 1 });
      world.step(DT, NO_CONTROLS);
    }
    expect(world.status).not.toBe('playing');
    expect(run['bolts'].list).toEqual([]);
  });
});
