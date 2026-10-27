import type { GalaxyEvent, HazardType } from '../../content/types';
import type { Asteroid } from '../asteroid';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import type { Foe } from '../foes/foe';
import type { Moving } from '../math';
import type { Rng } from '../rng';
import type { Ship } from '../ship';

/** A body a hazard can push or pull: anything with a place and a velocity. */
export interface Pullable extends Moving {
  x: number;
  y: number;
}

/** A spot in the field, and how far round it hazards keep out. */
export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** What a hazard can act on: the ship and the World's own rock list, and the foes. */
export interface Bodies {
  readonly ship: Ship;
  readonly rocks: Asteroid[];
  readonly foes: readonly Foe[];
}

/** What every hazard shows the renderer, the HUD and the bots: where it is, and how long until it changes. */
export interface HazardState {
  readonly id: number;
  readonly type: HazardType;
  readonly stage: 'warning' | 'active';
  readonly x: number;
  readonly y: number;
  readonly intensity: GalaxyEvent['intensity'];
  /** Seconds until it turns hostile (warning) or ends (active). */
  readonly remaining: number;
}

/**
 * One type of hazard, running every event of that type in a galaxy. It is harmless while it warns. The optional
 * parts are what it can do once active: pull bodies, strike the ship on contact, carry bodies elsewhere (teleports,
 * swallowing), or move the ship's respawn.
 */
export interface Hazard {
  /** Its warning or active hazards; a live view, mutated by `step`. */
  readonly states: readonly HazardState[];
  /** Advances to `elapsed` seconds into the galaxy, pushing its warnings, starts and ends into `out`. */
  step(elapsed: number, field: Field, out: SimEvent[]): void;
  /**
   * Nudges the rocks and foes in `bodies` by `dt` seconds of its pull. It never moves the ship: the ship's pull comes
   * from every hazard's state through `shipPullAt`, summed and capped, which a hazard that pulls the ship joins.
   */
  pull?(dt: number, bodies: Bodies): void;
  /** True when a ship of radius `r` at (x, y) touches a lethal part of it. */
  strikes?(x: number, y: number, r: number): boolean;
  /** Moves or removes bodies once the pulls are applied. */
  carry?(bodies: Bodies): void;
  /** Where a respawning ship must come back while it is active, or null for the default. */
  respawnPoint?(): Readonly<{ x: number; y: number }> | null;
  /** Stretches its places to the new field, like the World's other entities. */
  resize(old: Field, field: Field): void;
  /** Ends every warning and hazard at once, without an event: the galaxy is over. */
  stop(): void;
}

/** What a hazard is made with. */
export interface HazardSetup {
  /** The galaxy's events of this hazard's type, in order. */
  readonly events: readonly GalaxyEvent[];
  /** Its own stream (`hazardStreamName`): where it sits and anything else it rolls. */
  readonly rng: Rng;
  /** Hands out an id for each hazard. */
  readonly nextId: () => number;
  /** The circles a placed hazard keeps out of, as they stand when it is placed. */
  readonly keepOuts: (field: Field) => readonly Circle[];
}

export type HazardFactory = (setup: HazardSetup) => Hazard;
