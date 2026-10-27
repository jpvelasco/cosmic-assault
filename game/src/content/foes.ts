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
};

/** Radians per second a drone can turn toward the ship. */
export const DRONE_TURN_RATE = 2.2;
/**
 * How drones keep apart, so a swarm never stacks into what looks like one drone: a neighbour within `radius` units
 * pushes a drone's wanted heading away from it, up to `weight` times the pull of the ship when the two touch centres.
 */
export const DRONE_SEPARATION = { radius: 28, weight: 2.5 } as const;
/** A broken splitter leaves this many tiny fragments, each this many times as fast as a tiny rock. */
export const SPLITTER_FRAGMENTS = 3;
export const FRAGMENT_SPEED_MULTIPLIER = 1.6;

export function isFoeKind(kind: ThreatKind): kind is FoeKind {
  return Object.hasOwn(FOES, kind);
}
