import { HAZARD_RULES, WARP_RIFT } from '../../content/hazards';
import type { GalaxyEvent } from '../../content/types';
import { PLAYER } from '../config';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import { rescale, wrappedDistance, wrapPosition } from '../wrap';
import { zoneClearance, zoneKeepOutBoxes, type ZoneBox } from './dangerZone';
import type { Bodies, Circle, Hazard, HazardSetup, HazardState, RiftState } from './hazard';
import { HazardSchedule } from './schedule';

/** The grid a mouth is placed on, in field units: fine enough to find a spot on any field the game plays at. */
const GRID_STEP = 10;
/** Random pairs tried for an event before it gives up placing a pair. */
const TRIES = 64;
/** How far past its own rim a body lands from a mouth it leaves by, so it is not at once back inside it. */
const EXIT_GAP = 2;

/** A pair of mouths, as the schedule holds it: one hazard for both, its mouths at (x, y) and (toX, toY). */
interface Pair extends RiftState {
  stage: HazardState['stage'];
  x: number;
  y: number;
  toX: number;
  toY: number;
  remaining: number;
}

/** A body the rift may carry: its place, velocity and previous pose, which a jump resets. */
interface Mover {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
}

/**
 * The spots a mouth may take on a field: on the grid, inside the inset, clear of every keep-out circle (the centre, the
 * ship and any respawn point, all `setup.keepOuts`) by its radius, and of the HUD and thumb corners.
 */
function clearSpots(field: Field, circles: readonly Circle[]): { x: number; y: number }[] {
  const boxes = zoneKeepOutBoxes(field);
  const spots: { x: number; y: number }[] = [];
  const { inset, radius } = WARP_RIFT;
  for (let y = inset; y <= field.height - inset; y += GRID_STEP) {
    for (let x = inset; x <= field.width - inset; x += GRID_STEP) {
      if (circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + radius)) continue;
      if (boxes.some((box: ZoneBox) => zoneClearance(field, box, x, y) < radius)) continue;
      spots.push({ x, y });
    }
  }
  return spots;
}

/**
 * A galaxy's warp rifts, one event at a time: each shows `min(intensity, 2)` pairs of mouths as a warning for its
 * telegraph, then the pairs are open for their length. A body whose edge reaches an open mouth (`radius` plus its own)
 * leaves by the paired mouth, along its velocity and just outside it, with its previous pose reset so nothing streaks.
 * It never strikes. Mouths keep clear of the field's centre, the ship and the HUD and thumb corners, and of each other,
 * and sit at least `apart` of the field's width from their pair: placed from their own stream.
 */
export class WarpRifts implements Hazard {
  private readonly rng: Rng;
  private readonly nextId: () => number;
  private readonly keepOuts: (field: Field) => readonly Circle[];
  /** The schedule, holding the pairs warning or open: none, or up to two. */
  private readonly schedule: HazardSchedule<Pair>;
  /** The field the mouths lie in, as of the last step or resize; null before the first step. */
  private field: Field | null = null;

  constructor({ events, rng, nextId, keepOuts }: HazardSetup) {
    this.rng = rng;
    this.nextId = nextId;
    this.keepOuts = keepOuts;
    this.schedule = new HazardSchedule<Pair>(events, HAZARD_RULES.warpRift.telegraph, {
      warn: (event, elapsed, field, into, out) => {
        this.warn(event, elapsed, field, into, out);
      },
      started: (pair, out) => {
        out.push({ type: 'riftOpen', id: pair.id, x: pair.x, y: pair.y, toX: pair.toX, toY: pair.toY });
      },
      ended: (pair, out) => {
        out.push({ type: 'riftClose', id: pair.id });
      },
    });
  }

  get states(): readonly HazardState[] {
    return this.schedule.live;
  }

  step(elapsed: number, field: Field, out: SimEvent[]): void {
    this.field = field;
    this.schedule.step(elapsed, field, out);
  }

  resize(old: Field, field: Field): void {
    this.field = field;
    for (const pair of this.schedule.live) {
      pair.x = rescale(pair.x, old.width, field.width);
      pair.y = rescale(pair.y, old.height, field.height);
      pair.toX = rescale(pair.toX, old.width, field.width);
      pair.toY = rescale(pair.toY, old.height, field.height);
    }
  }

  stop(): void {
    this.schedule.stop();
  }

  /** Carries every body that reaches an open mouth to the other one of its pair, and says so. */
  carry(bodies: Bodies, out: SimEvent[]): void {
    const { field } = this;
    if (field === null) return;
    for (const pair of this.schedule.live) {
      if (pair.stage !== 'active') continue;
      this.carryBody(pair, field, bodies.ship, PLAYER.radius, true, out);
      for (const rock of bodies.rocks) this.carryBody(pair, field, rock, rock.radius, false, out);
      for (const foe of bodies.foes) this.carryBody(pair, field, foe, foe.radius, false, out);
    }
  }

  /** Warns of the next pairs an event shows: `min(intensity, 2)` of them, each placed where a pair fits, or not at all. */
  private warn(event: GalaxyEvent, elapsed: number, field: Field, into: Pair[], out: SimEvent[]): void {
    const spots = clearSpots(field, this.keepOuts(field));
    const count = Math.min(event.intensity, WARP_RIFT.maxPairs);
    for (let i = 0; i < count; i++) {
      const pair = this.place(elapsed, event, field, spots, into);
      if (pair === null) continue;
      into.push(pair);
      out.push({ type: 'riftWarning', id: pair.id, x: pair.x, y: pair.y, toX: pair.toX, toY: pair.toY });
    }
  }

  /** A pair of mouths drawn from the clear `spots`, apart from each other and from the mouths already placed. */
  private place(elapsed: number, event: GalaxyEvent, field: Field, spots: readonly { x: number; y: number }[], placed: readonly Pair[]): Pair | null {
    if (spots.length === 0) return null;
    const far = WARP_RIFT.apart * field.width;
    const apartFromPlaced = (s: { x: number; y: number }): boolean =>
      placed.every((p) => Math.hypot(s.x - p.x, s.y - p.y) >= 2 * WARP_RIFT.radius && Math.hypot(s.x - p.toX, s.y - p.toY) >= 2 * WARP_RIFT.radius);
    for (let i = 0; i < TRIES; i++) {
      const a = spots[this.rng.int(0, spots.length)];
      const b = spots[this.rng.int(0, spots.length)];
      if (a === undefined || b === undefined || Math.hypot(a.x - b.x, a.y - b.y) < far || !apartFromPlaced(a) || !apartFromPlaced(b)) continue;
      return { id: this.nextId(), type: 'warpRift', stage: 'warning', intensity: event.intensity, x: a.x, y: a.y, toX: b.x, toY: b.y, remaining: event.at - elapsed };
    }
    return null;
  }

  /** Sends `body` out of the other mouth of `pair` if it has reached an open mouth of it. */
  private carryBody(pair: Pair, field: Field, body: Mover, radius: number, ship: boolean, out: SimEvent[]): void {
    const reach = WARP_RIFT.radius + radius;
    if (wrappedDistance(body, pair, field) < reach) this.jump(pair, field, body, radius, pair.x, pair.y, pair.toX, pair.toY, ship, out);
    else if (wrappedDistance(body, { x: pair.toX, y: pair.toY }, field) < reach) this.jump(pair, field, body, radius, pair.toX, pair.toY, pair.x, pair.y, ship, out);
  }

  /** Puts `body` just outside the mouth at (toX, toY), along its velocity (or away from the mouth it entered if it is still), with its pose reset. */
  private jump(pair: Pair, field: Field, body: Mover, radius: number, fromX: number, fromY: number, toX: number, toY: number, ship: boolean, out: SimEvent[]): void {
    const speed = Math.hypot(body.vx, body.vy);
    let dx: number;
    let dy: number;
    if (speed > TIME_EPSILON) {
      dx = body.vx / speed;
      dy = body.vy / speed;
    } else {
      const apart = Math.hypot(toX - fromX, toY - fromY) || 1;
      dx = (toX - fromX) / apart;
      dy = (toY - fromY) / apart;
    }
    const gap = WARP_RIFT.radius + radius + EXIT_GAP;
    body.x = toX + dx * gap;
    body.y = toY + dy * gap;
    wrapPosition(body, field);
    body.px = body.x;
    body.py = body.y;
    out.push({ type: 'riftJump', id: pair.id, x: fromX, y: fromY, toX, toY, ship });
  }
}
