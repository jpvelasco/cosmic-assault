import type { BossView } from '../sim/boss/behaviour';
import type { Controls } from '../sim/controls';
import type { Field } from '../sim/field';
import type { Foe } from '../sim/foes/foe';
import type { WellState } from '../sim/hazards/gravityWell';
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
  pickups: readonly Readonly<Pickup>[];
  boss: Readonly<BossView> | null;
  well: Readonly<WellState> | null;
}

/** A bot: it reads the view and answers with the controls for the next step. The returned object may be reused. */
export interface Bot {
  decide(view: Readonly<BotView>): Controls;
}

/** The World's getters a bot reads, and nothing it could change the run with. */
export type WorldReadout = Pick<World, 'field' | 'status' | 'elapsed' | 'ship' | 'asteroids' | 'foes' | 'pickups' | 'boss' | 'well'>;

/** Refills `view` from `world`, without touching it. */
export function readView(world: WorldReadout, view: BotView): BotView {
  view.field = world.field;
  view.status = world.status;
  view.elapsed = world.elapsed;
  view.ship = world.ship;
  view.asteroids = world.asteroids;
  view.foes = world.foes;
  view.pickups = world.pickups;
  view.boss = world.boss;
  view.well = world.well;
  return view;
}

/** A view of `world` as it stands; refill it with `readView` after every step. */
export function createView(world: WorldReadout): BotView {
  const { field, status, elapsed, ship, asteroids, foes, pickups, boss, well } = world;
  return { field, status, elapsed, ship, asteroids, foes, pickups, boss, well };
}
