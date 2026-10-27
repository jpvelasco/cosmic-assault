import { describe, expect, it } from 'vitest';
import { EFFECT_SECONDS, noEffects, TIMED_PICKUPS } from '../../src/content/pickups';
import type { SimEvent } from '../../src/sim/events';
import { Loadout } from '../../src/sim/pickups/effects';

const DT = 1 / 120;

/** Steps `seconds` of fixed steps, collecting the events. */
function run(loadout: Loadout, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) loadout.step(DT, events);
  return events;
}

describe('Loadout tier', () => {
  it('starts at the tier it is given, default 0, and a weapon core adds one up to 3', () => {
    expect(new Loadout().tier).toBe(0);
    const l = new Loadout(1);
    expect(l.tier).toBe(1);
    l.collect('weaponCore');
    expect(l.tier).toBe(2);
    l.collect('weaponCore');
    l.collect('weaponCore');
    l.collect('weaponCore');
    expect(l.tier).toBe(3);
  });

  it('fires one more angle per tier through WEAPON_SPREAD', () => {
    const l = new Loadout();
    expect(l.weapon.barrels).toHaveLength(1);
    l.collect('weaponCore');
    expect(l.weapon.barrels).toHaveLength(2);
    l.collect('weaponCore');
    expect(l.weapon.barrels).toHaveLength(3);
    l.collect('weaponCore');
    expect(l.weapon.barrels).toHaveLength(5);
  });
});

describe('Loadout timed effects', () => {
  it.each(['doubleShot', 'rapidFire', 'spreadLaser', 'shield'] as const)('runs %s for its full time, then ends it with one effectEnded', (kind) => {
    const l = new Loadout();
    l.collect(kind);
    expect(l.effects[kind]).toBe(EFFECT_SECONDS[kind]);
    const events = run(l, EFFECT_SECONDS[kind] - 0.5);
    expect(events).toEqual([]);
    expect(l.effects[kind]).toBeCloseTo(0.5, 6);
    expect(run(l, 0.6)).toEqual([{ type: 'effectEnded', kind }]);
    expect(l.effects[kind]).toBe(0);
    expect(run(l, 1)).toEqual([]);
  });

  it('refreshes a same-kind pickup to a full timer and never stacks the effect', () => {
    const l = new Loadout();
    l.collect('doubleShot');
    run(l, 8);
    l.collect('doubleShot');
    expect(l.effects['doubleShot']).toBe(12);
    // Not 12 + 4: one pickup's worth of time, and the volley is the same two-wide one.
    expect(l.weapon.barrels).toHaveLength(2);
    run(l, 11.5);
    expect(l.effects['doubleShot']).toBeGreaterThan(0);
    expect(run(l, 0.6)).toEqual([{ type: 'effectEnded', kind: 'doubleShot' }]);
    expect(l.weapon.barrels).toHaveLength(1);
  });

  it('refreshing rapid fire keeps the fire interval at 0.6, not 0.36', () => {
    const l = new Loadout();
    l.collect('rapidFire');
    l.collect('rapidFire');
    expect(l.weapon.fireIntervalScale).toBe(0.6);
  });

  it('runs different kinds side by side, each on its own clock', () => {
    const l = new Loadout();
    l.collect('doubleShot');
    run(l, 5);
    l.collect('rapidFire');
    expect(l.effects).toMatchObject({ doubleShot: expect.closeTo(7, 6) as number, rapidFire: 12, spreadLaser: 0, shield: 0 });
    expect(run(l, 7.1)).toEqual([{ type: 'effectEnded', kind: 'doubleShot' }]);
    expect(l.effects['rapidFire']).toBeGreaterThan(4);
  });

  it('stops being shielded when the shield breaks, with no effectEnded of its own', () => {
    const l = new Loadout();
    l.collect('shield');
    expect(l.shielded).toBe(true);
    l.breakShield();
    expect(l.shielded).toBe(false);
    expect(run(l, 20)).toEqual([]);
  });

  it('changes the weapon only while an effect runs', () => {
    const l = new Loadout();
    const plain = l.weapon;
    expect(l.weapon).toBe(plain);
    l.collect('spreadLaser');
    expect(l.weapon.barrels).toHaveLength(3);
    run(l, 13);
    expect(l.weapon.barrels).toEqual(plain.barrels);
  });
});

describe('Loadout shot rules and time scale', () => {
  it('pierces 3 targets while the Piercing Beam runs, and stops when it ends', () => {
    const l = new Loadout();
    l.collect('piercingBeam');
    expect(l.shotRules.pierce).toBe(3);
    run(l, EFFECT_SECONDS.piercingBeam);
    expect(l.shotRules.pierce).toBe(0);
  });

  it('homes every third shot while Homing Missiles run, and flies the Wingman while it runs', () => {
    const l = new Loadout();
    l.collect('homingMissiles');
    l.collect('wingman');
    expect(l.shotRules).toEqual({ pierce: 0, homingEvery: 3, wingman: true });
    run(l, EFFECT_SECONDS.homingMissiles);
    expect(l.shotRules).toEqual({ pierce: 0, homingEvery: 0, wingman: false });
  });

  it('returns the same rules object until an effect starts or ends, so reading it each step allocates nothing', () => {
    const l = new Loadout();
    l.collect('wingman');
    const rules = l.shotRules;
    run(l, 1);
    expect(l.shotRules).toBe(rules);
  });

  it('runs the foes at half speed while Time Warp runs, and at full speed again after its 8 s', () => {
    const l = new Loadout();
    expect(l.timeScale).toBe(1);
    l.collect('timeWarp');
    expect(l.timeScale).toBe(0.5);
    run(l, EFFECT_SECONDS.timeWarp);
    expect(l.timeScale).toBe(1);
  });

  it.each(['fieldBomb', 'nova'] as const)('leaves the tier and every effect alone for a %s: its blast is the run\'s', (kind) => {
    const l = new Loadout(1);
    const weapon = l.weapon;
    l.collect(kind);
    expect(l.tier).toBe(1);
    expect(l.effects).toEqual(noEffects());
    expect(l.weapon).toBe(weapon);
  });
});

describe('Loadout death', () => {
  it('clears every timed effect and the shield, reporting each as ended', () => {
    const l = new Loadout(2);
    for (const kind of ['doubleShot', 'rapidFire', 'shield'] as const) l.collect(kind);
    const events: SimEvent[] = [];
    l.die(events, false);
    expect(events).toEqual([
      { type: 'effectEnded', kind: 'doubleShot' },
      { type: 'effectEnded', kind: 'rapidFire' },
      { type: 'effectEnded', kind: 'shield' },
    ]);
    expect(l.effects).toEqual(noEffects());
    expect(l.shielded).toBe(false);
    expect(l.weapon.fireIntervalScale).toBe(1);
    expect(l.tier).toBe(2);
  });

  it('ends every M6 effect with the ship too: piercing, homing, the wingman and time warp', () => {
    const l = new Loadout();
    for (const kind of TIMED_PICKUPS) l.collect(kind);
    const events: SimEvent[] = [];
    l.die(events, false);
    expect(events).toEqual(TIMED_PICKUPS.map((kind) => ({ type: 'effectEnded', kind })));
    expect(l.effects).toEqual(noEffects());
    expect(l.shotRules).toEqual({ pierce: 0, homingEvery: 0, wingman: false });
    expect(l.timeScale).toBe(1);
  });

  it('drops one tier when asked, never below 0', () => {
    const l = new Loadout(1);
    l.die([], true);
    expect(l.tier).toBe(0);
    l.die([], true);
    expect(l.tier).toBe(0);
  });

  it('reports nothing when no effect was running', () => {
    const events: SimEvent[] = [];
    new Loadout().die(events, true);
    expect(events).toEqual([]);
  });
});
