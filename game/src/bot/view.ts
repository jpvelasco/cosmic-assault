import type { BossView } from '../sim/boss/behaviour';
import type { Controls } from '../sim/controls';
import type { Field } from '../sim/field';
import type { Bolt } from '../sim/foes/bolts';
import type { Foe } from '../sim/foes/foe';
import type { HazardState } from '../sim/hazards/hazard';
import type { Pickup } from '../sim/pickups/pickups';
import type { Asteroid } from '../sim/asteroid';
import type { Ship } from '../sim/ship';
import type { World, WorldStatus } from '../sim/world';

/**
 * What a bot sees of the World after a step: read-only, refilled in place by `readView` so a step allocates nothing.
 * Its lists are the World's live ones, valid until the next step.
 */
export interface BotView {
  field: Field;
  status: WorldStatus;
  elapsed: number;
  ship: Readonly<Ship>;
  asteroids: readonly Readonly<Asteroid>[];
  foes: readonly Readonly<Foe>[];
  bolts: readonly Readonly<Bolt>[];
  pickups: readonly Readonly<Pickup>[];
  boss: Readonly<BossView> | null;
  hazards: readonly Readonly<HazardState>[];
}

/** A bot: it reads the view and answers with the controls for the next step. The returned object may be reused. */
export interface Bot {
  decide(view: Readonly<BotView>): Controls;
}

/** The World's getters a bot reads, and nothing it could change the run with. */
export type WorldReadout = Pick<World, 'field' | 'status' | 'elapsed' | 'ship' | 'asteroids' | 'foes' | 'bolts' | 'pickups' | 'boss' | 'hazards'>;

/** Refills `view` from `world`, without touching it. */
export function readView(world: WorldReadout, view: BotView): BotView {
  view.field = world.field;
  view.status = world.status;
  view.elapsed = world.elapsed;
  view.ship = world.ship;
  view.asteroids = world.asteroids;
  view.foes = world.foes;
  view.bolts = world.bolts;
  view.pickups = world.pickups;
  view.boss = world.boss;
  view.hazards = world.hazards;
  return view;
}

/** A view of `world` as it stands; refill it with `readView` after every step. */
export function createView(world: WorldReadout): BotView {
  const { field, status, elapsed, ship, asteroids, foes, bolts, pickups, boss, hazards } = world;
  return { field, status, elapsed, ship, asteroids, foes, bolts, pickups, boss, hazards };
}
