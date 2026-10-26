import { describe, expect, it } from 'vitest';
import { PLAYER, VOLLEY, WEAPON_SPREAD } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { weaponFor, type TimedFlags } from '../../src/sim/pickups/volley';
import { createShip, stepShip, tierBarrels, type Barrel } from '../../src/sim/ship';
import type { WeaponTier } from '../../src/content/types';

const NONE: TimedFlags = { doubleShot: false, rapidFire: false, spreadLaser: false };
const TIERS: readonly WeaponTier[] = [0, 1, 2, 3];
const FIELD = { width: 1280, height: 720 };

const angles = (barrels: readonly Barrel[]): number[] => barrels.map((b) => b.angle);
const sortedBy = (barrels: readonly Barrel[]): string[] => barrels.map((b) => `${String(b.angle)}@${String(b.lateral)}`).sort();

describe('weaponFor', () => {
  it.each(TIERS)('fires tier %i with its WEAPON_SPREAD angles on the nose axis and no change to the fire interval', (tier) => {
    const weapon = weaponFor(tier, NONE);
    expect(angles(weapon.barrels)).toEqual(WEAPON_SPREAD[tier]);
    expect(weapon.barrels.every((b) => b.lateral === 0)).toBe(true);
    expect(weapon.fireIntervalScale).toBe(1);
  });

  it('doubles every shot into a parallel pair 6 units either side of the nose axis (Double Shot)', () => {
    const weapon = weaponFor(0, { ...NONE, doubleShot: true });
    expect(weapon.barrels).toEqual([
      { angle: 0, lateral: -VOLLEY.parallelOffset },
      { angle: 0, lateral: VOLLEY.parallelOffset },
    ]);
    expect(VOLLEY.parallelOffset).toBe(6);
    expect(weapon.fireIntervalScale).toBe(1);
  });

  it('adds a shot at +0.22 and -0.22 rad to the centre shot (Spread Laser)', () => {
    const weapon = weaponFor(0, { ...NONE, spreadLaser: true });
    expect(sortedBy(weapon.barrels)).toEqual(sortedBy([{ angle: 0, lateral: 0 }, { angle: -0.22, lateral: 0 }, { angle: 0.22, lateral: 0 }]));
    expect(weapon.barrels).toHaveLength(3);
  });

  it('runs the fire interval at 0.6 of normal (Rapid Fire) and changes nothing else', () => {
    const weapon = weaponFor(2, { ...NONE, rapidFire: true });
    expect(weapon.fireIntervalScale).toBe(0.6);
    expect(angles(weapon.barrels)).toEqual(WEAPON_SPREAD[2]);
  });

  it('composes in order: tier spread, then x2 parallel, then the Spread Laser pair (which is not doubled)', () => {
    const weapon = weaponFor(1, { ...NONE, doubleShot: true, spreadLaser: true });
    expect(weapon.barrels).toHaveLength(2 * 2 + 2);
    const pair = weapon.barrels.filter((b) => Math.abs(b.angle) === VOLLEY.spreadLaserAngle);
    expect(pair).toEqual([
      { angle: -VOLLEY.spreadLaserAngle, lateral: 0 },
      { angle: VOLLEY.spreadLaserAngle, lateral: 0 },
    ]);
    expect(weapon.barrels.filter((b) => Math.abs(b.lateral) === 6)).toHaveLength(4);
  });

  it('never fires more than 7 shots in a volley, for every combination of tier and effects', () => {
    for (const tier of TIERS)
      for (const doubleShot of [false, true])
        for (const spreadLaser of [false, true])
          expect(weaponFor(tier, { doubleShot, spreadLaser, rapidFire: false }).barrels.length, `${String(tier)} ${String(doubleShot)} ${String(spreadLaser)}`).toBeLessThanOrEqual(VOLLEY.maxShots);
    expect(VOLLEY.maxShots).toBe(7);
  });

  it('keeps a volley of exactly 7 whole: tier 3 with Spread Laser is 5 + 2', () => {
    expect(weaponFor(3, { ...NONE, spreadLaser: true }).barrels).toHaveLength(7);
  });

  it('drops the outermost pairs first above 7: tier 3 + Double Shot (10) loses its +-0.3 shots', () => {
    const barrels = weaponFor(3, { ...NONE, doubleShot: true }).barrels;
    expect(barrels).toHaveLength(6);
    expect(Math.max(...barrels.map((b) => Math.abs(b.angle)))).toBe(0.18);
  });

  it('drops the Spread Laser pair first when it is the outermost: tier 2 + Double Shot + Spread Laser (8) keeps 6', () => {
    const barrels = weaponFor(2, { ...NONE, doubleShot: true, spreadLaser: true }).barrels;
    expect(barrels).toHaveLength(6);
    expect(barrels.every((b) => Math.abs(b.angle) !== VOLLEY.spreadLaserAngle)).toBe(true);
  });

  it('keeps a capped volley mirror-symmetric, so it never leans', () => {
    for (const tier of TIERS)
      for (const doubleShot of [false, true])
        for (const spreadLaser of [false, true]) {
          const { barrels } = weaponFor(tier, { doubleShot, spreadLaser, rapidFire: true });
          expect(sortedBy(barrels), `${String(tier)} ${String(doubleShot)} ${String(spreadLaser)}`).toEqual(sortedBy(barrels.map((b) => ({ angle: -b.angle, lateral: -b.lateral }))));
        }
  });

  it('returns the same weapon for the same inputs, so the ship can fire from a cached one', () => {
    expect(weaponFor(2, { ...NONE, doubleShot: true })).toEqual(weaponFor(2, { ...NONE, doubleShot: true }));
  });
});

describe('stepShip with a weapon', () => {
  const firing = { ...NO_CONTROLS, fire: true };
  const faceUp = () => createShip(640, 360);

  it('fires the tier it has when given no weapon, exactly as a weapon built from that tier does', () => {
    for (const tier of TIERS) {
      const a = faceUp();
      a.tier = (tier + 1) as 1 | 2 | 3 | 4;
      a.vx = 20;
      const b = faceUp();
      b.vx = 20;
      expect(stepShip(b, firing, 1 / 120, FIELD, { barrels: tierBarrels(tier), fireIntervalScale: 1 })).toEqual(stepShip(a, firing, 1 / 120, FIELD));
      expect(b.fireCooldown).toBe(a.fireCooldown);
    }
  });

  it('puts parallel shots either side of the nose, along the ship\'s own right', () => {
    const ship = faceUp();
    const shots = stepShip(ship, firing, 1 / 120, FIELD, weaponFor(0, { ...NONE, doubleShot: true }));
    expect(shots).toHaveLength(2);
    const [left, right] = shots;
    // Facing up (-y), the ship's right is +x.
    expect((right?.x ?? 0) - (left?.x ?? 0)).toBeCloseTo(12, 9);
    expect(left?.y).toBeCloseTo(right?.y ?? NaN, 9);
    expect(left?.vx).toBeCloseTo(0, 9);
    expect(left?.vy).toBeCloseTo(-PLAYER.projectileSpeed, 9);
  });

  it('scales the cooldown it sets by fireIntervalScale', () => {
    const ship = faceUp();
    stepShip(ship, firing, 1 / 120, FIELD, weaponFor(0, { ...NONE, rapidFire: true }));
    expect(ship.fireCooldown).toBeCloseTo(PLAYER.fireInterval * 0.6, 12);
  });
});
