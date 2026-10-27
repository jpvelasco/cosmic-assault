import { describe, expect, it } from 'vitest';
import { FIELD_HEIGHT } from '../../src/sim/config';
import type { Foe } from '../../src/sim/foes/foe';
import { createShip } from '../../src/sim/ship';
import { chooseTarget, type Target } from '../../src/bot/targeting';
import type { BotView } from '../../src/bot/view';
import { FOES } from '../../src/content/foes';

const FIELD = { width: 1280, height: FIELD_HEIGHT };
const SHIP_X = 640;
const SHIP_Y = 360;

/** A foe of `kind` at (x, y), facing `rotation`, unmoving, as a World would hold it. */
function foeAt(kind: Foe['kind'], id: number, x: number, y: number, rotation = 0): Foe {
  const { radius, hp } = FOES[kind];
  return { id, kind, x, y, px: x, py: y, vx: 0, vy: 0, rotation, protation: rotation, spin: 0, radius, hp, fromAttack: false, timer: 0, charging: false, aimX: 0, aimY: 0, orbit: 1 };
}

/** A view of a still ship at the middle of a 16:9 field with `foes` on it and nothing else. */
function viewWith(foes: Foe[]): BotView {
  const ship = createShip(SHIP_X, SHIP_Y);
  ship.angle = 0;
  return { field: FIELD, status: 'playing', elapsed: 10, ship, asteroids: [], foes, bolts: [], pickups: [], boss: null, hazards: [] };
}

const target = (): Target => ({ x: 0, y: 0, vx: 0, vy: 0, wraps: true, weakPoint: false });

describe('the expert and the armoured rock', () => {
  // The rock sits 200 units to the ship's right; the ship lies at bearing π from it.
  const ROCK_X = SHIP_X + 200;

  it('does not shoot an armoured rock whose soft arc faces away from the ship', () => {
    const out = target();
    expect(chooseTarget(viewWith([foeAt('armoured', 1, ROCK_X, SHIP_Y, 0)]), out)).toBe(false);
  });

  it('shoots an armoured rock whose soft arc faces the ship within 30 degrees', () => {
    const out = target();
    const rock = foeAt('armoured', 1, ROCK_X, SHIP_Y, Math.PI + 0.4);
    expect(chooseTarget(viewWith([rock]), out)).toBe(true);
    expect(out.x).toBe(ROCK_X);
  });

  it('holds fire on an armoured rock whose soft arc faces 40 degrees off the ship', () => {
    const out = target();
    expect(chooseTarget(viewWith([foeAt('armoured', 1, ROCK_X, SHIP_Y, Math.PI + 0.7)]), out)).toBe(false);
  });

  it('shoots another target when the armoured rock is out of its soft arc', () => {
    const out = target();
    const small = foeAt('drone', 2, SHIP_X + 80, SHIP_Y + 10);
    expect(chooseTarget(viewWith([foeAt('armoured', 1, ROCK_X, SHIP_Y, 0), small]), out)).toBe(true);
    expect(out.x).toBe(SHIP_X + 80);
  });

  it('targets a phaser ahead of a rock nearer to the ship', () => {
    const out = target();
    const phaser = foeAt('phaser', 1, SHIP_X + 300, SHIP_Y, 0);
    const near = { id: 2, x: SHIP_X + 10, y: SHIP_Y + 10, vx: 0, vy: 0, radius: 15, size: 2, rotation: 0, spin: 0, px: 0, py: 0, protation: 0 } as const;
    expect(chooseTarget({ ...viewWith([phaser]), asteroids: [near as never] }, out)).toBe(true);
    expect(out.x).toBe(SHIP_X + 300);
  });

  it('reads an armoured rock\'s facing across the wrap: a ship just over the seam is shot at from its facing', () => {
    // The ship is 20 units past the left edge, which the rock at x 10 reaches across the wrap: its nearest bearing points west.
    const out = target();
    const rock = foeAt('armoured', 1, 10, SHIP_Y, Math.PI);
    const view = viewWith([rock]);
    view.ship = { ...view.ship, x: FIELD.width - 10 };
    expect(chooseTarget(view, out)).toBe(true);
    expect(out.x).toBe(10);
  });
});
