import type { Dimension, FoeKind, ThreatKind } from './types';

/** What a foe is on the field. Costs are in the director's threat-budget units, the same as a rock's. */
export interface FoeDef {
  /** The first Dimension it appears in; no earlier galaxy may give it a ramp. */
  readonly from: Dimension;
  readonly radius: number;
  readonly hp: number;
  /** What one foe weighs on the budget while it is on the field. */
  readonly cost: number;
  /** Points for the killing blow, before the combo multiplier. */
  readonly points: number;
  /** Units per second. */
  readonly speed: number;
  /** How many arrive per spawn order: min and max, both inclusive. */
  readonly group: readonly [number, number];
  /** Whether a gravity well pulls it. A foe that steers itself at a fixed speed is not. */
  readonly pulled: boolean;
}

export const FOES: Readonly<Record<FoeKind, FoeDef>> = {
  // A rock between the medium (80) and the small (110) in speed; it scores what a small rock does (100).
  splitter: { from: 1, radius: 30, hp: 2, cost: 3, points: 100, speed: 95, group: [1, 1], pulled: true },
  drone: { from: 2, radius: 12, hp: 1, cost: 1, points: 100, speed: 110, group: [3, 5], pulled: false },
  gunship: { from: 3, radius: 18, hp: 3, cost: 4, points: 250, speed: 80, group: [1, 1], pulled: false },
  mine: { from: 3, radius: 12, hp: 1, cost: 2, points: 150, speed: 25, group: [1, 2], pulled: true },
  phaser: { from: 4, radius: 16, hp: 2, cost: 2.5, points: 200, speed: 90, group: [1, 2], pulled: false },
  armoured: { from: 4, radius: 42, hp: 3, cost: 4, points: 300, speed: 60, group: [1, 1], pulled: true },
};

/** Radians per second a drone can turn toward the ship. */
export const DRONE_TURN_RATE = 2.2;
/**
 * How drones keep apart, so a swarm never stacks into what looks like one drone: a neighbour within `radius` units
 * pushes a drone's wanted heading away from it, up to `weight` times the pull of the ship when the two touch centres.
 */
export const DRONE_SEPARATION = { radius: 28, weight: 2.5 } as const;
/**
 * How a gunship fights: it circles the ship between `orbit` units out, turning at up to `turnRate` rad/s, and keeps
 * `separation` from the gunships beside it as drones do. Every `cadence` ± `cadenceJitter` seconds it winds up for
 * `windup` seconds, aiming where the ship is then, and fires one bolt there. One that may not fire (the ship cannot be
 * hurt, or it is outside the field) tries again after a random `retry` seconds, so gunships kept waiting never wind up
 * together. No more than `maxLive` fly at once.
 */
export const GUNSHIP = {
  orbit: [240, 300],
  turnRate: 1.6,
  separation: { radius: 70, weight: 2.5 },
  cadence: 2.6,
  cadenceJitter: 0.4,
  windup: 0.5,
  retry: [0.3, 1],
  maxLive: 4,
} as const;
/**
 * How a mine goes off: a ship that touches its `armRadius` arms it, and `fuse` seconds later it blasts everything within
 * `blastRadius`. It drifts in no nearer the ship than the safe radius plus `armRadius`.
 */
export const MINE = { armRadius: 110, fuse: 0.6, blastRadius: 80 } as const;
/**
 * How a phaser blinks: every `every` ± `everyJitter` seconds it shows its warning for `warn` seconds, a flash at its
 * origin and an outline where it will blink to, `range` units off (and at least `inset` inside the field's edges). It
 * seeks the ship at its speed and turn rate, keeping `separation` from the phasers beside it, as a drone does.
 */
export const PHASER = {
  every: 3,
  everyJitter: 0.5,
  warn: 0.5,
  range: [180, 300],
  inset: 40,
  /** A ship this near where it would blink holds it back: the phaser warns again rather than blink onto the ship. */
  clear: 40,
  tries: 16,
  turnRate: 1.8,
  separation: { radius: 36, weight: 2 },
} as const;
/**
 * How an armoured rock fights: its soft arc is `softArc` radians either side of its facing, and a shot that strikes
 * outside it is spent with no harm. It spins at most `spin` rad/s, and breaks into `shards` small rocks.
 */
export const ARMOURED = { softArc: (50 * Math.PI) / 180, spin: 0.35, shards: 2 } as const;
/** A broken splitter leaves this many tiny fragments, each this many times as fast as a tiny rock. */
export const SPLITTER_FRAGMENTS = 3;
export const FRAGMENT_SPEED_MULTIPLIER = 1.6;

/**
 * Hostile bolts, shared by every foe and boss that fires them: their radius, their default speed in units per second, the
 * seconds each lives, and how many can be on the field at once.
 */
export const BOLT = { radius: 5, speed: 230, life: 3.2, capacity: 96 } as const;

export function isFoeKind(kind: ThreatKind): kind is FoeKind {
  return Object.hasOwn(FOES, kind);
}
