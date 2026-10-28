import { FOES, PHASER } from '../../content/foes';
import { edgePoint } from '../asteroid';
import { ASTEROID, PLAYER } from '../config';
import type { Field } from '../field';
import { TAU, TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Ship } from '../ship';
import { wrappedDistance } from '../wrap';
import type { Foe, FoeBehaviour, FoeWorld } from './foe';
import { edgeLine, enterAt, steer, type Flight } from './steer';

const FLIGHT: Flight = { speed: FOES.phaser.speed, turnRate: PHASER.turnRate, separation: PHASER.separation };
/** Centre to centre along the edge: a clear gap of a radius between neighbours. */
const SPACING = FOES.phaser.radius * 3;

/** Seconds from one warning to the next, from the 'foes' stream. */
const cadence = (rng: Rng): number => rng.range(PHASER.every - PHASER.everyJitter, PHASER.every + PHASER.everyJitter);

/** Whether (x, y) lies inside the field's inset: far enough from every edge that the phaser never blinks across one. */
const inside = (x: number, y: number, field: Field): boolean =>
  x >= PHASER.inset && x <= field.width - PHASER.inset && y >= PHASER.inset && y <= field.height - PHASER.inset;

/**
 * Picks where `foe` will blink to: a spot `range` off it in a random direction, inside the field's inset and at least
 * the safe radius from the ship, written into `foe.aimX`/`aimY`. False when none of the `tries` found one.
 */
function choose(foe: Foe, field: Field, ship: Readonly<Ship>, rng: Rng): boolean {
  for (let i = 0; i < PHASER.tries; i++) {
    const bearing = rng.range(0, TAU);
    const distance = rng.range(PHASER.range[0], PHASER.range[1]);
    const x = foe.x + Math.cos(bearing) * distance;
    const y = foe.y + Math.sin(bearing) * distance;
    if (!inside(x, y, field) || wrappedDistance(ship, { x, y }, field) < ASTEROID.safeRadius) continue;
    foe.aimX = x;
    foe.aimY = y;
    return true;
  }
  return false;
}

/** A ship this near where the phaser would land when its blink is due would be touched as it lands: so it warns again. */
const crowded = (foe: Readonly<Foe>, field: Field, ship: Readonly<Ship>): boolean =>
  wrappedDistance(ship, { x: foe.aimX, y: foe.aimY }, field) < FOES.phaser.radius + PLAYER.radius + PHASER.clear;

/**
 * Starts (or restarts) a warning: the phaser holds its origin, flashing, and an outline shows where it will blink to.
 * False when no spot is found, so the caller can wait for the next cadence instead.
 */
function warn(foe: Foe, field: Field, { arena, rng }: FoeWorld): boolean {
  if (!choose(foe, field, arena.ship, rng)) return false;
  foe.charging = true;
  foe.timer = PHASER.warn;
  arena.events.push({ type: 'phaserWarn', id: foe.id, x: foe.x, y: foe.y, toX: foe.aimX, toY: foe.aimY });
  return true;
}

/**
 * A phaser: a diamond that seeks the ship and, every 3 ± 0.5 s, flashes for its warning and blinks to a spot 180 to 300
 * units off. It has no hitbox at that spot until it blinks there. A ship so near the spot when the blink is due that
 * the phaser would land on it holds the blink back, and the phaser warns again at a fresh spot. It arrives from an
 * edge, outside the safe radius.
 */
export const PHASER_BEHAVIOUR: FoeBehaviour = {
  spawn(world, count) {
    const { arena, rng } = world;
    const field = arena.field();
    const [edge, start] = edgeLine(rng, count, SPACING, field, arena.ship);
    for (let i = 0; i < count; i++) {
      const foe = world.acquire('phaser');
      if (foe === null) return;
      enterAt(foe, edgePoint(edge, start + i * SPACING, field), arena.ship, FOES.phaser.speed);
      foe.timer = cadence(rng);
      world.commit(foe);
    }
  },

  step(foe, dt, field, world) {
    const { arena, rng, list } = world;
    if (!foe.charging) steer(foe, arena.ship.x - foe.x, arena.ship.y - foe.y, dt, FLIGHT, field, list);
    foe.timer -= dt;
    if (foe.timer > TIME_EPSILON) return;
    if (!foe.charging) {
      if (!warn(foe, field, world)) foe.timer = cadence(rng);
      return;
    }
    if (crowded(foe, field, arena.ship)) {
      if (!warn(foe, field, world)) {
        foe.charging = false;
        foe.timer = cadence(rng);
      }
      return;
    }
    foe.x = foe.aimX;
    foe.y = foe.aimY;
    foe.px = foe.x;
    foe.py = foe.y;
    foe.charging = false;
    // The next warning is a cadence after this one began: the blink took PHASER.warn of it.
    foe.timer = cadence(rng) - PHASER.warn;
    arena.events.push({ type: 'phaserBlink', id: foe.id, x: foe.x, y: foe.y });
  },
};
