import { describe, expect, it } from 'vitest';
import { PLAYER, VOLLEY, WEAPON_SPREAD } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { weaponFor, type TimedFlags } from '../../src/sim/pickups/volley';
import { createShip, stepShip, type Barrel } from '../../src/sim/ship';
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

  it('trims the tier\'s outermost shots first above 7: tier 3 + Double Shot (10) loses its +-0.3 shots', () => {
    const barrels = weaponFor(3, { ...NONE, doubleShot: true }).barrels;
    expect(barrels).toHaveLength(6);
    expect(Math.max(...barrels.map((b) => Math.abs(b.angle)))).toBe(0.18);
  });

  it('keeps Double Shot\'s pair on the centre shot and the Spread Laser pair whatever the tier: tier 3 + both is 4 shots', () => {
    const { barrels } = weaponFor(3, { ...NONE, doubleShot: true, spreadLaser: true });
    expect(sortedBy(barrels)).toEqual(
      sortedBy([
        { angle: 0, lateral: -VOLLEY.parallelOffset },
        { angle: 0, lateral: VOLLEY.parallelOffset },
        { angle: -VOLLEY.spreadLaserAngle, lateral: 0 },
        { angle: VOLLEY.spreadLaserAngle, lateral: 0 },
      ]),
    );
  });

  it('keeps the inner pair of a tier with no centre shot: tier 1 never loses it', () => {
    const { barrels } = weaponFor(1, { ...NONE, doubleShot: true, spreadLaser: true });
    expect(barrels).toHaveLength(6);
    expect(barrels.filter((b) => Math.abs(b.angle) === 0.12)).toHaveLength(4);
  });

  it('makes every active volley effect count: removing any one of them changes the weapon, at every tier', () => {
    const KINDS = ['doubleShot', 'rapidFire', 'spreadLaser'] as const;
    for (const tier of TIERS)
      for (let mask = 1; mask < 8; mask++) {
        const flags: TimedFlags = { doubleShot: (mask & 1) !== 0, rapidFire: (mask & 2) !== 0, spreadLaser: (mask & 4) !== 0 };
        const full = weaponFor(tier, flags);
        expect(full.barrels.length, `tier ${String(tier)} ${String(mask)}`).toBeLessThanOrEqual(VOLLEY.maxShots);
        for (const kind of KINDS.filter((k) => flags[k])) {
          const without = weaponFor(tier, { ...flags, [kind]: false });
          expect(without, `tier ${String(tier)} without ${kind} of ${String(mask)}`).not.toEqual(full);
        }
      }
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

  it('fires a single shot from the nose when given no weapon, exactly as the tier 0 weapon does', () => {
    const a = faceUp();
    a.vx = 20;
    const b = faceUp();
    b.vx = 20;
    const plain = stepShip(a, firing, 1 / 120, FIELD);
    expect(plain).toHaveLength(1);
    expect(stepShip(b, firing, 1 / 120, FIELD, weaponFor(0, NONE))).toEqual(plain);
    expect(b.fireCooldown).toBe(a.fireCooldown);
    expect(a.fireCooldown).toBe(PLAYER.fireInterval);
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
