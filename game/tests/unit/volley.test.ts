import { describe, expect, it } from 'vitest';
import { PLAYER, VOLLEY, WEAPON_SPREAD } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { shotRulesFor, triggerShots, weaponFor, type TimedFlags } from '../../src/sim/pickups/volley';
import { createShip, stepShip, type Barrel } from '../../src/sim/ship';
import type { WeaponTier } from '../../src/content/types';

const NONE: TimedFlags = { doubleShot: false, rapidFire: false, spreadLaser: false, piercingBeam: false, homingMissiles: false, wingman: false };
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

  it('turns the centre shot into a parallel pair 6 units either side of the nose axis (Double Shot)', () => {
    const weapon = weaponFor(0, { ...NONE, doubleShot: true });
    expect(weapon.barrels).toEqual([
      { angle: 0, lateral: -VOLLEY.parallelOffset },
      { angle: 0, lateral: VOLLEY.parallelOffset },
    ]);
    expect(VOLLEY.parallelOffset).toBe(6);
    expect(weapon.fireIntervalScale).toBe(1);
  });

  it('pairs only the centre shot of a wider tier, leaving the rest of its fan alone', () => {
    const { barrels } = weaponFor(3, { ...NONE, doubleShot: true });
    expect(barrels).toHaveLength(6);
    expect(barrels.filter((b) => b.lateral !== 0)).toEqual([
      { angle: 0, lateral: -6 },
      { angle: 0, lateral: 6 },
    ]);
    expect(angles(barrels.filter((b) => b.lateral === 0))).toEqual([-0.18, 0.18, -0.3, 0.3]);
  });

  it('pairs the innermost angles of a tier with no centre shot (tier 1), keeping the volley symmetric', () => {
    const { barrels } = weaponFor(1, { ...NONE, doubleShot: true });
    expect(barrels).toHaveLength(4);
    expect(barrels.every((b) => Math.abs(b.angle) === 0.12 && Math.abs(b.lateral) === 6)).toBe(true);
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

  it('composes in order: tier spread, then the Double Shot pair, then the Spread Laser pair (which is not paired)', () => {
    const weapon = weaponFor(1, { ...NONE, doubleShot: true, spreadLaser: true });
    expect(weapon.barrels).toHaveLength(4 + 2);
    expect(weapon.barrels.filter((b) => Math.abs(b.angle) === VOLLEY.spreadLaserAngle)).toEqual([
      { angle: -VOLLEY.spreadLaserAngle, lateral: 0 },
      { angle: VOLLEY.spreadLaserAngle, lateral: 0 },
    ]);
    expect(weapon.barrels.filter((b) => Math.abs(b.lateral) === 6)).toHaveLength(4);
  });

  it('never trims: the largest volley, tier 3 with Double Shot and Spread Laser, is 5 + 1 + 2 = 8, and 8 is the ceiling', () => {
    expect(VOLLEY.maxShots).toBe(8);
    const { barrels } = weaponFor(3, { ...NONE, doubleShot: true, spreadLaser: true });
    expect(barrels).toHaveLength(8);
    expect(weaponFor(3, { ...NONE, spreadLaser: true }).barrels).toHaveLength(7);
  });

  it('keeps every effect on top of the one before: no pickup ever weakens the volley', () => {
    // Collecting Double Shot while Spread Laser runs at tier 3 takes the volley from 7 to 8, not down.
    expect(weaponFor(3, { ...NONE, spreadLaser: true }).barrels.length).toBeLessThan(weaponFor(3, { ...NONE, spreadLaser: true, doubleShot: true }).barrels.length);
  });

  it('holds the volley invariants for every tier and every combination of the kinds that change fire: the ship fires at most 8, a trigger at most 9, each active kind changes what fires, and adding a kind never loses a shot', () => {
    const KINDS = ['doubleShot', 'rapidFire', 'spreadLaser', 'piercingBeam', 'homingMissiles', 'wingman'] as const;
    /** The kinds that add a shot to each trigger; the rest change how the shots fly, not how many there are. */
    const ADDING: readonly (typeof KINDS)[number][] = ['doubleShot', 'spreadLaser', 'wingman'];
    const flagsOf = (mask: number): TimedFlags => Object.fromEntries(KINDS.map((kind, bit) => [kind, (mask & (1 << bit)) !== 0])) as unknown as TimedFlags;
    const fired = (tier: WeaponTier, flags: TimedFlags) => ({ weapon: weaponFor(tier, flags), rules: shotRulesFor(flags) });
    let combinations = 0;
    for (const tier of TIERS)
      for (let mask = 0; mask < 1 << KINDS.length; mask++) {
        combinations++;
        const flags = flagsOf(mask);
        const full = fired(tier, flags);
        const count = triggerShots(full.weapon, full.rules);
        const where = `tier ${String(tier)} mask ${String(mask)}`;
        expect(full.weapon.barrels.length, where).toBeLessThanOrEqual(VOLLEY.maxShots);
        expect(count, where).toBeLessThanOrEqual(VOLLEY.maxPerTrigger);
        for (const kind of KINDS) {
          if (flags[kind]) expect(fired(tier, { ...flags, [kind]: false }), `${where} without ${kind}`).not.toEqual(full);
          else {
            const more = fired(tier, { ...flags, [kind]: true });
            const added = triggerShots(more.weapon, more.rules);
            if (ADDING.includes(kind)) expect(added, `${where} adding ${kind}`).toBeGreaterThan(count);
            else expect(added, `${where} adding ${kind}`).toBe(count);
          }
        }
      }
    expect(combinations).toBe(4 * 64);
  });

  it('reaches the ceilings only with everything at once: 8 from the ship at tier 3 with Double Shot and Spread Laser, and the Wingman\'s ninth', () => {
    expect(VOLLEY.maxPerTrigger).toBe(9);
    const all = { doubleShot: true, rapidFire: true, spreadLaser: true, piercingBeam: true, homingMissiles: true, wingman: true };
    expect(triggerShots(weaponFor(3, all), shotRulesFor(all))).toBe(9);
    expect(weaponFor(3, all).barrels).toHaveLength(8);
  });

  it('sets the shot rules from the running kinds: 3 pierces, every third shot homing, and the Wingman', () => {
    expect(shotRulesFor(NONE)).toEqual({ pierce: 0, homingEvery: 0, wingman: false });
    expect(shotRulesFor({ ...NONE, piercingBeam: true })).toEqual({ pierce: 3, homingEvery: 0, wingman: false });
    expect(shotRulesFor({ ...NONE, homingMissiles: true })).toEqual({ pierce: 0, homingEvery: 3, wingman: false });
    expect(shotRulesFor({ ...NONE, wingman: true })).toEqual({ pierce: 0, homingEvery: 0, wingman: true });
  });

  it('leaves the ship\'s weapon alone for the kinds that change only the shots: piercing, homing and the Wingman', () => {
    for (const tier of TIERS) expect(weaponFor(tier, { ...NONE, piercingBeam: true, homingMissiles: true, wingman: true }), String(tier)).toEqual(weaponFor(tier, NONE));
  });

  it('keeps every volley mirror-symmetric, so it never leans', () => {
    for (const tier of TIERS)
      for (const doubleShot of [false, true])
        for (const spreadLaser of [false, true]) {
          const { barrels } = weaponFor(tier, { ...NONE, doubleShot, spreadLaser, rapidFire: true });
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
