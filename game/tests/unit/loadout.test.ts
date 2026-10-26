import { describe, expect, it } from 'vitest';
import { EFFECT_SECONDS } from '../../src/content/pickups';
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
    expect(l.effects).toEqual({ doubleShot: 0, rapidFire: 0, spreadLaser: 0, shield: 0 });
    expect(l.shielded).toBe(false);
    expect(l.weapon.fireIntervalScale).toBe(1);
    expect(l.tier).toBe(2);
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
