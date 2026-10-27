import { eventsOfType } from '../../content/curves';
import { FORCE_SIGN, MAX_SHIP_PULL, WELL_SPEED_CAP } from '../../content/hazards';
import type { GalaxyEvent, HazardType } from '../../content/types';
import type { Asteroid } from '../asteroid';
import { ASTEROID } from '../config';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import type { Foe } from '../foes/foe';
import { nudge } from '../math';
import type { Rng } from '../rng';
import type { Ship } from '../ship';
import { ForceField } from './forceField';
import type { Bodies, Circle, Hazard, HazardFactory, HazardState } from './hazard';

/** How each hazard type is made; a type the schedule names needs an entry here. */
export const HAZARD_FACTORIES: Readonly<Partial<Record<HazardType, HazardFactory>>> = {
  gravityWell: (setup) => new ForceField('gravityWell', FORCE_SIGN.gravityWell, setup),
  repulsionField: (setup) => new ForceField('repulsionField', FORCE_SIGN.repulsionField, setup),
};

/** The stream a hazard type draws from: the gravity wells keep M5's `'hazards'`, so Ion Reach does not move. */
export const hazardStreamName = (type: HazardType): string => (type === 'gravityWell' ? 'hazards' : `hazards:${type}`);

/** How far round the field's centre, where the ship starts and respawns, placed hazards keep out. */
const CENTRE_KEEP_OUT = 150;

/**
 * Every hazard of a galaxy: one per hazard type its schedule names, each running that type's events. It sums their
 * pulls on the ship and applies them once a step, capped at `MAX_SHIP_PULL`, so however many act at once a
 * thrusting ship still beats them.
 */
export class HazardField {
  private readonly hazards: Hazard[] = [];
  private readonly list: HazardState[] = [];
  private readonly shipPull = { x: 0, y: 0 };
  /** Made on the first move and refilled on every other, so moving bodies costs no allocation. */
  private bodies: { -readonly [K in keyof Bodies]: Bodies[K] } | null = null;
  private readonly circles: Circle[] = [];

  /**
   * @param events the galaxy's events; its showers are left to the director
   * @param stream the stream each hazard type draws from (`hazardStreamName`)
   * @param nextId hands out an id for each hazard
   * @param ship the ship, which the placed hazards keep clear of
   */
  constructor(
    events: readonly GalaxyEvent[],
    stream: (type: HazardType) => Rng,
    nextId: () => number,
    private readonly ship: Readonly<Ship>,
    factories: Readonly<Partial<Record<HazardType, HazardFactory>>> = HAZARD_FACTORIES,
  ) {
    const keepOuts = (field: Field): readonly Circle[] => this.keepOuts(field);
    for (const type of new Set(events.map((e) => e.type))) {
      if (type === 'meteorShower') continue;
      const make = factories[type];
      if (make === undefined) throw new Error(`The schedule names a ${type} but no hazard is made for it: add a ${type} factory to HAZARD_FACTORIES`);
      this.hazards.push(make({ events: eventsOfType(events, type), rng: stream(type), nextId, keepOuts }));
    }
  }

  /** Every warning or active hazard, for the renderer, the HUD and the bots; a live view, refilled by `step`. */
  get states(): readonly HazardState[] {
    return this.list;
  }

  step(elapsed: number, field: Field, out: SimEvent[]): void {
    for (const hazard of this.hazards) hazard.step(elapsed, field, out);
    this.refill();
  }

  /** Applies every hazard's pull, the ship's summed and capped into one nudge, then lets them carry bodies. */
  move(dt: number, ship: Ship, rocks: Asteroid[], foes: readonly Foe[]): void {
    const bodies = (this.bodies ??= { ship, rocks, foes });
    bodies.ship = ship;
    bodies.rocks = rocks;
    bodies.foes = foes;
    const { shipPull } = this;
    shipPull.x = 0;
    shipPull.y = 0;
    for (const hazard of this.hazards) hazard.pull?.(dt, bodies, shipPull);
    const pull = Math.hypot(shipPull.x, shipPull.y);
    if (pull > 0) {
      const scale = Math.min(1, (MAX_SHIP_PULL * dt) / pull);
      nudge(ship, shipPull.x * scale, shipPull.y * scale, WELL_SPEED_CAP);
    }
    for (const hazard of this.hazards) hazard.carry?.(bodies);
  }

  /** True when a ship of radius `r` at (x, y) touches a lethal hazard. */
  strikes(x: number, y: number, r: number): boolean {
    for (const hazard of this.hazards) if (hazard.strikes?.(x, y, r) === true) return true;
    return false;
  }

  /** Where a respawning ship must come back, if an active hazard says so; else null. */
  respawnPoint(): Readonly<{ x: number; y: number }> | null {
    for (const hazard of this.hazards) {
      const spot = hazard.respawnPoint?.() ?? null;
      if (spot !== null) return spot;
    }
    return null;
  }

  /** The circles placed hazards keep out of: the field's centre, any respawn point and the ship's safe radius. */
  keepOuts(field: Field): readonly Circle[] {
    const { circles, ship } = this;
    circles.length = 0;
    circles.push({ x: field.width / 2, y: field.height / 2, r: CENTRE_KEEP_OUT });
    const spot = this.respawnPoint();
    if (spot !== null) circles.push({ x: spot.x, y: spot.y, r: ASTEROID.safeRadius });
    circles.push({ x: ship.x, y: ship.y, r: ASTEROID.safeRadius });
    return circles;
  }

  resize(old: Field, field: Field): void {
    for (const hazard of this.hazards) hazard.resize(old, field);
  }

  stop(): void {
    for (const hazard of this.hazards) hazard.stop();
    this.refill();
  }

  private refill(): void {
    const { list } = this;
    list.length = 0;
    for (const hazard of this.hazards) for (const state of hazard.states) list.push(state);
  }
}
