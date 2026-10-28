import { eventsOfType } from '../../content/curves';
import { FORCE_SIGN, WELL_SPEED_CAP } from '../../content/hazards';
import type { GalaxyEvent, HazardType } from '../../content/types';
import type { Asteroid } from '../asteroid';
import { ASTEROID } from '../config';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import type { HazardBolts } from './hazard';
import type { Foe } from '../foes/foe';
import { nudge } from '../math';
import { createRng, deriveSeed, type Rng } from '../rng';
import type { Ship } from '../ship';
import { BlackHole } from './blackHole';
import { DangerZones } from './dangerZone';
import { ForceField } from './forceField';
import type { Bodies, Circle, Hazard, HazardFactory, HazardState } from './hazard';
import { shipPullAt } from './shipPull';
import { WarpRifts } from './warpRift';

/** How each hazard type is made; a type the schedule names needs an entry here. */
export const HAZARD_FACTORIES: Readonly<Partial<Record<HazardType, HazardFactory>>> = {
  gravityWell: (setup) => new ForceField('gravityWell', FORCE_SIGN.gravityWell, setup),
  repulsionField: (setup) => new ForceField('repulsionField', FORCE_SIGN.repulsionField, setup),
  dangerZone: (setup) => new DangerZones(setup),
  warpRift: (setup) => new WarpRifts(setup),
  blackHole: (setup) => new BlackHole(setup),
};

/** The stream a hazard type draws from: the gravity wells keep M5's `'hazards'`, so Ion Reach does not move. */
export const hazardStreamName = (type: HazardType): string => (type === 'gravityWell' ? 'hazards' : `hazards:${type}`);

/** The hazard streams of a run with `seed`: each type's made on first ask and the same one after, so none is drawn twice over. */
export function hazardStreams(seed: number): (type: HazardType) => Rng {
  const made = new Map<HazardType, Rng>();
  return (type) => {
    const rng = made.get(type) ?? createRng(deriveSeed(seed, hazardStreamName(type)));
    made.set(type, rng);
    return rng;
  };
}

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
  /** Made on the first move and refilled on every other, so moving bodies costs no allocation. Its ship is the one the keep-outs avoid. */
  private bodies: { -readonly [K in keyof Bodies]: Bodies[K] } | null = null;
  /** The keep-outs, refilled in place from three reused circles. */
  private readonly circles: Circle[] = [];
  private readonly slots: { x: number; y: number; r: number }[] = [0, 1, 2].map(() => ({ x: 0, y: 0, r: 0 }));

  /**
   * @param events the galaxy's events; its showers are left to the director
   * @param stream the stream each hazard type draws from (`hazardStreamName`)
   * @param nextId hands out an id for each hazard
   */
  constructor(
    events: readonly GalaxyEvent[],
    stream: (type: HazardType) => Rng,
    nextId: () => number,
    factories: Readonly<Partial<Record<HazardType, HazardFactory>>> = HAZARD_FACTORIES,
  ) {
    const keepOuts = (field: Field): readonly Circle[] => this.keepOuts(field);
    for (const type of new Set(events.map((e) => e.type))) {
      if (type === 'meteorShower') continue;
      const make = factories[type];
      if (make === undefined) throw new Error(`The schedule names a ${type} but no hazard is made for it: add a ${type} factory to HAZARD_FACTORIES`);
      this.hazards.push(make({ events: eventsOfType(events, type), rng: stream(type), nextId, keepOuts, inPlay: () => this.list }));
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

  /**
   * Applies every hazard's pull to the rocks and foes, nudges the ship once by `shipPullAt` (summed, capped), then lets
   * the hazards carry bodies. The pull acts on a ship invulnerable after its respawn too, as it did in M5:
   * invulnerability spares the ship collisions, not physics.
   */
  move(dt: number, ship: Ship, rocks: Asteroid[], foes: readonly Foe[], out: SimEvent[], bolts: HazardBolts | null = null): void {
    const bodies = (this.bodies ??= { ship, rocks, foes, bolts });
    bodies.ship = ship;
    bodies.rocks = rocks;
    bodies.foes = foes;
    bodies.bolts = bolts;
    for (const hazard of this.hazards) hazard.pull?.(dt, bodies);
    const pull = shipPullAt(this.list, ship.x, ship.y, dt, this.shipPull);
    if (pull.x !== 0 || pull.y !== 0) nudge(ship, pull.x, pull.y, WELL_SPEED_CAP);
    for (const hazard of this.hazards) hazard.carry?.(bodies, out);
  }

  /** True when a ship of radius `r` at (x, y) touches a lethal hazard. */
  strikes(x: number, y: number, r: number): boolean {
    for (const hazard of this.hazards) if (hazard.strikes?.(x, y, r) === true) return true;
    return false;
  }

  /** True when a player shot of radius `r` at (x, y) is taken by a hazard, such as a black hole's horizon. */
  swallows(x: number, y: number, r: number): boolean {
    for (const hazard of this.hazards) if (hazard.swallows?.(x, y, r) === true) return true;
    return false;
  }

  /** Where a respawning ship must come back, if an active hazard says so, clear of the foes as of the last move; else null. */
  respawnPoint(): Readonly<{ x: number; y: number }> | null {
    const foes = this.bodies?.foes ?? [];
    for (const hazard of this.hazards) {
      const spot = hazard.respawnPoint?.(foes) ?? null;
      if (spot !== null) return spot;
    }
    return null;
  }

  /**
   * The circles placed hazards keep out of: the field's centre, any respawn point and the safe radius of the ship
   * last moved (none before the first move). A live view, refilled by each call.
   */
  keepOuts(field: Field): readonly Circle[] {
    const { circles } = this;
    circles.length = 0;
    this.keepOut(field.width / 2, field.height / 2, CENTRE_KEEP_OUT);
    const spot = this.respawnPoint();
    if (spot !== null) this.keepOut(spot.x, spot.y, ASTEROID.safeRadius);
    const ship = this.bodies?.ship;
    if (ship !== undefined) this.keepOut(ship.x, ship.y, ASTEROID.safeRadius);
    return circles;
  }

  private keepOut(x: number, y: number, r: number): void {
    const slot = this.slots[this.circles.length];
    if (slot === undefined) throw new Error('HazardField keeps out at most 3 circles: add a slot for the new one');
    slot.x = x;
    slot.y = y;
    slot.r = r;
    this.circles.push(slot);
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
