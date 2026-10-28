import { describe, expect, it } from 'vitest';
import { ARMOURED, FOES, PHASER } from '../../src/content/foes';
import { ASTEROID, PLAYER, PROJECTILE, STEP_SECONDS, VOLLEY } from '../../src/sim/config';
import type { Field } from '../../src/sim/field';
import type { Foe } from '../../src/sim/foes/foe';
import { FOE_DEFLECTED } from '../../src/sim/foes/foeField';
import { PlayerShots, type ShotTargets } from '../../src/sim/shots';
import { wrappedDistance } from '../../src/sim/wrap';
import { ofType } from '../helpers/bossArena';
import { foeRig, onlyFoe, runFoes } from '../helpers/foeRig';

const FIELD: Field = { width: 1280, height: 720 };
const DT = STEP_SECONDS;


/** The point `distance` from (x, y) along `bearing`. */
const along = (x: number, y: number, bearing: number, distance: number): { x: number; y: number } => ({
  x: x + Math.cos(bearing) * distance,
  y: y + Math.sin(bearing) * distance,
});

describe('phaser', () => {
  it('arrives with 2 HP and radius 16, announced, outside the safe radius', () => {
    const r = foeRig();
    r.foes.spawn('phaser', 1, 1);
    const foe = onlyFoe(r);
    expect(foe).toMatchObject({ kind: 'phaser', hp: 2, radius: FOES.phaser.radius });
    expect(ofType(r.arena.events, 'foeSpawned')).toHaveLength(1);
    expect(wrappedDistance(foe, { x: FIELD.width / 2, y: FIELD.height / 2 }, FIELD)).toBeGreaterThanOrEqual(ASTEROID.safeRadius - 1);
  });

  it('seeks the ship at its speed', () => {
    const r = foeRig();
    r.foes.spawn('phaser', 1, 1);
    const foe = onlyFoe(r);
    runFoes(r, 0.5);
    expect(Math.hypot(foe.vx, foe.vy)).toBeCloseTo(FOES.phaser.speed, 6);
  });

  it('warns every 3 ± 0.5 s, so each gap between warnings lies in [2.5, 3.5]', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = foeRig({ seed });
      r.foes.spawn('phaser', 1, 1);
      const warnings = runFoes(r, 40)
        .filter((l) => l.event.type === 'phaserWarn')
        .map((l) => l.t);
      expect(warnings.length, `seed ${String(seed)}`).toBeGreaterThanOrEqual(10);
      for (let i = 1; i < warnings.length; i++) {
        const gap = (warnings[i] ?? 0) - (warnings[i - 1] ?? 0);
        expect(gap, `seed ${String(seed)} gap ${String(i)}`).toBeGreaterThanOrEqual(PHASER.every - PHASER.everyJitter - DT);
        expect(gap, `seed ${String(seed)} gap ${String(i)}`).toBeLessThanOrEqual(PHASER.every + PHASER.everyJitter + DT);
      }
    }
  });

  it('holds still for its 0.5 s warning, then blinks to the spot it warned of, away at 180 to 300 units', () => {
    const r = foeRig({ seed: 2 });
    r.foes.spawn('phaser', 1, 1);
    const foe = onlyFoe(r);
    const seen: { origin?: { x: number; y: number } } = {};
    const log = runFoes(r, 6, () => {
      if (seen.origin === undefined && r.arena.events.some((e) => e.type === 'phaserWarn')) seen.origin = { x: foe.x, y: foe.y };
    });
    const origin = seen.origin;
    const warn = log.find((l) => l.event.type === 'phaserWarn');
    const blink = log.find((l) => l.event.type === 'phaserBlink');
    const warned = warn?.event;
    const blinked = blink?.event;
    if (warn === undefined || blink === undefined || warned?.type !== 'phaserWarn' || blinked?.type !== 'phaserBlink' || origin === undefined) throw new Error('expected a warning and a blink');
    expect(warned).toMatchObject({ id: foe.id, x: origin.x, y: origin.y });
    expect(blinked.id).toBe(foe.id);
    expect(blink.t - warn.t).toBeCloseTo(PHASER.warn, 2);
    expect(blinked).toMatchObject({ x: warned.toX, y: warned.toY });
    expect(Math.hypot(blinked.x - origin.x, blinked.y - origin.y)).toBeGreaterThanOrEqual(PHASER.range[0]);
    expect(Math.hypot(blinked.x - origin.x, blinked.y - origin.y)).toBeLessThanOrEqual(PHASER.range[1]);
  });

  it('warns of a destination at least the safe radius from the ship and 40 inside the field', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = foeRig({ seed });
      r.foes.spawn('phaser', 1, 1);
      for (const { event } of runFoes(r, 30)) {
        if (event.type !== 'phaserWarn') continue;
        expect(Math.hypot(event.toX - r.arena.ship.x, event.toY - r.arena.ship.y), `seed ${String(seed)}`).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
        expect(event.toX).toBeGreaterThanOrEqual(PHASER.inset);
        expect(event.toX).toBeLessThanOrEqual(FIELD.width - PHASER.inset);
        expect(event.toY).toBeGreaterThanOrEqual(PHASER.inset);
        expect(event.toY).toBeLessThanOrEqual(FIELD.height - PHASER.inset);
      }
    }
  });

  it('has no hitbox at its destination until it blinks: a ship there while it warns is not struck', () => {
    const r = foeRig({ seed: 3 });
    r.foes.spawn('phaser', 1, 1);
    const ship = r.arena.ship;
    const home = { x: ship.x, y: ship.y };
    let checked = false;
    runFoes(r, 6, (t) => {
      if (checked || !r.arena.events.some((e) => e.type === 'phaserWarn')) return;
      checked = true;
      const warn = r.arena.events.find((e) => e.type === 'phaserWarn');
      if (warn?.type !== 'phaserWarn') throw new Error('expected a warning');
      // Stand the ship on the spot before it blinks there: nothing is there to strike it yet.
      expect(r.foes.strikes(warn.toX, warn.toY, PLAYER.radius)).toBe(false);
      expect(t).toBeGreaterThan(0);
      ship.x = warn.toX;
      ship.y = warn.toY;
      expect(r.foes.strikes(warn.toX, warn.toY, PLAYER.radius)).toBe(false);
      ship.x = home.x;
      ship.y = home.y;
    });
    expect(checked).toBe(true);
  });

  it('does not blink onto a ship standing where it would arrive: it stays at its origin when due, and warns again then', () => {
    const r = foeRig({ seed: 4 });
    r.foes.spawn('phaser', 1, 1);
    const foe = onlyFoe(r);
    const warning = { at: -1, origin: { x: 0, y: 0 }, parked: false };
    let dueAt = Infinity;
    let dueSeen: { x: number; y: number } | null = null;
    const log = runFoes(r, 6, (t) => {
      const warn = r.arena.events.find((e) => e.type === 'phaserWarn');
      if (!warning.parked && warn?.type === 'phaserWarn') {
        // Park the ship on the spot it warned of, and hold it there: the blink is due and must be withheld.
        warning.parked = true;
        warning.at = t;
        warning.origin = { x: warn.x, y: warn.y };
        dueAt = t + PHASER.warn;
        r.arena.ship.x = warn.toX;
        r.arena.ship.y = warn.toY;
      }
      if (dueSeen === null && t >= dueAt - DT / 2) dueSeen = { x: foe.x, y: foe.y };
    });
    expect(warning.parked).toBe(true);
    expect(dueSeen).not.toBeNull();
    const seen = dueSeen as unknown as { x: number; y: number };
    expect(seen.x).toBeCloseTo(warning.origin.x, 6);
    expect(seen.y).toBeCloseTo(warning.origin.y, 6);
    const near = (t: number): boolean => Math.abs(t - dueAt) < DT * 1.5;
    expect(log.filter((l) => l.event.type === 'phaserBlink' && near(l.t))).toHaveLength(0);
    expect(log.filter((l) => l.event.type === 'phaserWarn' && near(l.t))).toHaveLength(1);
  });

  it('leaves its pose unstretched on the blink step, and is struck where it lands', () => {
    const r = foeRig({ seed: 5 });
    r.foes.spawn('phaser', 1, 1);
    const foe = onlyFoe(r);
    const landed = { blinks: 0, struck: false, unstretched: false };
    runFoes(r, 6, () => {
      if (landed.blinks > 0 || !r.arena.events.some((e) => e.type === 'phaserBlink')) return;
      landed.blinks++;
      landed.unstretched = foe.px === foe.x && foe.py === foe.y;
      // Probed on the step it lands, before the phaser moves on: a ship there would be struck.
      landed.struck = r.foes.strikes(foe.x, foe.y, PLAYER.radius);
    });
    expect(landed.blinks).toBe(1);
    expect(landed.unstretched).toBe(true);
    expect(landed.struck).toBe(true);
  });
});

describe('armoured rock', () => {
  /** Where a shot strikes `foe` from `bearing` off its centre: just inside its rim, so its bearing is what the foe judges. */
  const shotAt = (foe: Readonly<Foe>, bearing: number): { x: number; y: number } => along(foe.x, foe.y, bearing, foe.radius * 0.9);

  it('arrives with 3 HP and radius 42, spinning at most 0.35 rad/s', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = foeRig({ seed });
      r.foes.spawn('armoured', 1, 1);
      const foe = onlyFoe(r);
      expect(foe).toMatchObject({ kind: 'armoured', hp: 3, radius: FOES.armoured.radius });
      expect(Math.abs(foe.spin)).toBeLessThanOrEqual(ARMOURED.spin);
    }
  });

  it('takes a hit on its soft arc like any other: 1 damage and a foeHit', () => {
    const r = foeRig({ seed: 6 });
    r.foes.spawn('armoured', 1, 1);
    runFoes(r, DT);
    const foe = onlyFoe(r);
    const at = shotAt(foe, foe.rotation);
    expect(r.foes.hit(at.x, at.y, PROJECTILE.radius)).toBe(foe.id);
    expect(foe.hp).toBe(2);
    expect(ofType(r.arena.events, 'foeHit')).toHaveLength(1);
  });

  it('deflects a shot that strikes outside its soft arc: spent for no harm, with foeDeflected where it struck', () => {
    const r = foeRig({ seed: 7 });
    r.foes.spawn('armoured', 1, 1);
    runFoes(r, DT);
    const foe = onlyFoe(r);
    const at = shotAt(foe, foe.rotation + Math.PI / 2);
    expect(r.foes.hit(at.x, at.y, PROJECTILE.radius)).toBe(FOE_DEFLECTED);
    expect(foe.hp).toBe(3);
    expect(ofType(r.arena.events, 'foeDeflected')).toEqual([{ type: 'foeDeflected', id: foe.id, x: at.x, y: at.y }]);
  });

  it('puts the soft arc edge at 50 degrees either side of its facing, both ways round', () => {
    const r = foeRig({ seed: 8 });
    r.foes.spawn('armoured', 1, 1);
    runFoes(r, DT);
    const foe = onlyFoe(r);
    expect(ARMOURED.softArc).toBeCloseTo((50 * Math.PI) / 180, 12);
    for (const sign of [1, -1]) {
      const inside = shotAt(foe, foe.rotation + sign * (ARMOURED.softArc - 0.02));
      const outside = shotAt(foe, foe.rotation + sign * (ARMOURED.softArc + 0.02));
      expect(r.foes.hit(inside.x, inside.y, PROJECTILE.radius), `inside, sign ${String(sign)}`).toBe(foe.id);
      expect(r.foes.hit(outside.x, outside.y, PROJECTILE.radius), `outside, sign ${String(sign)}`).toBe(FOE_DEFLECTED);
    }
  });

  it('spends a piercing shot it deflects, and lets a piercing shot through its soft arc pass on', () => {
    const r = foeRig({ seed: 9 });
    r.foes.spawn('armoured', 1, 1);
    runFoes(r, DT);
    const foe = onlyFoe(r);
    const targets: ShotTargets = {
      rocks: [],
      foes: () => r.foes.list,
      aim: () => null,
      hitBoss: () => false,
      hitFoe: (x, y, radius, struck) => r.foes.hit(x, y, radius, struck),
      hitRock: () => -1,
    };
    let nextId = 1000;
    const shots = new PlayerShots(r.arena.events, () => ++nextId);
    const fire = (bearing: number): void => {
      const at = shotAt(foe, bearing);
      shots.fire([{ x: at.x, y: at.y, vx: -Math.cos(bearing) * PLAYER.projectileSpeed, vy: -Math.sin(bearing) * PLAYER.projectileSpeed }], r.arena.ship, {
        pierce: VOLLEY.pierceTargets,
        homingEvery: 0,
        wingman: false,
      });
      shots.collide(targets);
    };
    fire(foe.rotation + Math.PI / 2);
    expect(shots.list).toHaveLength(0);
    expect(foe.hp).toBe(3);
    fire(foe.rotation);
    expect(shots.list).toHaveLength(1);
    expect(shots.list[0]?.struck).toEqual([foe.id]);
    expect(foe.hp).toBe(2);
  });

  it('breaks into two small rocks when a shot destroys it, scoring its points and dropping no pickup', () => {
    const r = foeRig({ seed: 10 });
    r.foes.spawn('armoured', 1, 1);
    runFoes(r, DT);
    const foe = onlyFoe(r);
    for (let i = 0; i < FOES.armoured.hp; i++) {
      const at = shotAt(foe, foe.rotation);
      r.foes.hit(at.x, at.y, PROJECTILE.radius);
    }
    expect(r.points).toContain(FOES.armoured.points);
    expect(r.arena.asteroids).toHaveLength(ARMOURED.shards);
    for (const rock of r.arena.asteroids) expect(rock.size).toBe(2);
    expect(r.killed).toHaveLength(1);
  });

  it('is destroyed by a blast that reaches it, with no shards and no deflection', () => {
    const r = foeRig({ seed: 11 });
    r.foes.spawn('armoured', 1, 1);
    const foe = onlyFoe(r);
    r.foes.blast(foe.x, foe.y, 40);
    expect(r.foes.list).toHaveLength(0);
    expect(r.arena.asteroids).toHaveLength(0);
  });
});
