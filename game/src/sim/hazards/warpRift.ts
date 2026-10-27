import { HAZARD_RULES, WARP_RIFT } from '../../content/hazards';
import type { GalaxyEvent } from '../../content/types';
import { ASTEROID, PLAYER } from '../config';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import { rescale, wrapDelta, wrapPosition } from '../wrap';
import { zoneClearance, zoneKeepOutBoxes, type ZoneBox } from './dangerZone';
import type { Bodies, Circle, Hazard, HazardSetup, HazardState, RiftState } from './hazard';
import { HazardSchedule } from './schedule';

/** The grid a mouth is placed on, in field units: fine enough to find a spot on any field the game plays at. */
const GRID_STEP = 10;
/** Random first mouths tried for an event before it gives up placing a pair. */
const TRIES = 16;
/** How far past its own rim a body lands from a mouth it leaves by, so it is not at once back inside it. */
const EXIT_GAP = 2;
/**
 * The least distance between mouths of different pairs. A body leaving one mouth lands `radius + body + EXIT_GAP` out of
 * it, and must still lie beyond the reach (`radius + body`) of every other mouth: for the largest body a jump carries,
 * that is `2·radius + 2·body + EXIT_GAP` apart.
 */
export const MOUTH_SPACING = 2 * WARP_RIFT.radius + 2 * ASTEROID.radii[0] + EXIT_GAP;
/**
 * The least distance a second pair may sit at on a crowded field where `MOUTH_SPACING` will not fit (at 4:3, about a
 * fifth of second pairs otherwise): the ship's bound, for a ship leaving one mouth lands `radius + PLAYER.radius + EXIT_GAP`
 * out, past the reach of the other. A large rock leaving such a pair may then hop to the other on a later step, never
 * within the same one.
 */
export const SHIP_SPACING = 2 * WARP_RIFT.radius + 2 * PLAYER.radius + EXIT_GAP;

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
 * ship and any respawn point, all `setup.keepOuts`) by the mouth's own radius, and of the HUD and thumb corners by its
 * drawn radius, so its swirl never sits under them.
 */
function clearSpots(field: Field, circles: readonly Circle[]): { x: number; y: number }[] {
  const boxes = zoneKeepOutBoxes(field);
  const spots: { x: number; y: number }[] = [];
  const { inset, drawn } = WARP_RIFT;
  for (let y = inset; y <= field.height - inset; y += GRID_STEP) {
    for (let x = inset; x <= field.width - inset; x += GRID_STEP) {
      if (circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + WARP_RIFT.radius)) continue;
      if (boxes.some((box: ZoneBox) => zoneClearance(field, box, x, y) < drawn)) continue;
      spots.push({ x, y });
    }
  }
  return spots;
}

/** Whether the body centred at `body`, with reach `reach`, lies within it of (x, y) across the wrap. */
const near = (field: Field, body: Mover, x: number, y: number, reach: number): boolean =>
  Math.hypot(wrapDelta(x - body.x, field.width), wrapDelta(y - body.y, field.height)) < reach;

/**
 * A galaxy's warp rifts, one event at a time: each shows `min(intensity, 2)` pairs of mouths as a warning for its
 * telegraph, then the pairs are open for their length. A body whose edge reaches an open mouth (`radius` plus its own)
 * leaves by the paired mouth, along its velocity and just outside it, with its previous pose reset so nothing streaks.
 * A body leaves at most once a step. It never strikes. Mouths keep clear of the field's centre, the ship and the HUD
 * and thumb corners, and of each other across pairs (`MOUTH_SPACING`), and sit at least `apart` of the field's width
 * from their pair: placed from their own stream.
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

  /** Carries every body that reaches an open mouth to the other one of its pair, the ship first. */
  carry(bodies: Bodies, out: SimEvent[]): void {
    const { field } = this;
    if (field === null) return;
    this.carryBody(field, bodies.ship, PLAYER.radius, true, out);
    for (const rock of bodies.rocks) this.carryBody(field, rock, rock.radius, false, out);
    // A phaser that is warning is on its way to its blink spot: carrying it would leave its blink spot where it is not.
    for (const foe of bodies.foes) if (!(foe.kind === 'phaser' && foe.charging)) this.carryBody(field, foe, foe.radius, false, out);
  }

  /** Warns of the next pairs an event shows: `min(intensity, 2)` of them, each placed where a pair fits, or not at all. */
  private warn(event: GalaxyEvent, elapsed: number, field: Field, into: Pair[], out: SimEvent[]): void {
    const spots = clearSpots(field, this.keepOuts(field));
    const count = Math.min(event.intensity, WARP_RIFT.maxPairs);
    for (let i = 0; i < count; i++) {
      const pair = this.place(elapsed, event, field, spots, into, MOUTH_SPACING) ?? this.place(elapsed, event, field, spots, into, SHIP_SPACING);
      if (pair === null) continue;
      into.push(pair);
      out.push({ type: 'riftWarning', id: pair.id, x: pair.x, y: pair.y, toX: pair.toX, toY: pair.toY });
    }
  }

  /**
   * A pair drawn from the clear `spots`: its first mouth from those at least `spacing` from every mouth already placed, its
   * second from those also `apart` of the field's width from the first. Null if no pair fits at this spacing.
   */
  private place(elapsed: number, event: GalaxyEvent, field: Field, spots: readonly { x: number; y: number }[], placed: readonly Pair[], spacing: number): Pair | null {
    const far = WARP_RIFT.apart * field.width;
    const free = spots.filter((s) => placed.every((p) => Math.hypot(s.x - p.x, s.y - p.y) >= spacing && Math.hypot(s.x - p.toX, s.y - p.toY) >= spacing));
    if (free.length === 0) return null;
    for (let i = 0; i < TRIES; i++) {
      const a = free[this.rng.int(0, free.length)];
      if (a === undefined) continue;
      const partners = free.filter((s) => Math.hypot(s.x - a.x, s.y - a.y) >= far);
      if (partners.length === 0) continue;
      const b = partners[this.rng.int(0, partners.length)];
      if (b === undefined) continue;
      return { id: this.nextId(), type: 'warpRift', stage: 'warning', intensity: event.intensity, x: a.x, y: a.y, toX: b.x, toY: b.y, remaining: event.at - elapsed };
    }
    return null;
  }

  /** Sends `body` out of the other mouth of the first open pair it reaches, once; true if one did. */
  private carryBody(field: Field, body: Mover, radius: number, ship: boolean, out: SimEvent[]): boolean {
    const reach = WARP_RIFT.radius + radius;
    for (const pair of this.schedule.live) {
      if (pair.stage !== 'active') continue;
      if (near(field, body, pair.x, pair.y, reach)) {
        this.jump(pair, field, body, radius, pair.x, pair.y, pair.toX, pair.toY, ship, out);
        return true;
      }
      if (near(field, body, pair.toX, pair.toY, reach)) {
        this.jump(pair, field, body, radius, pair.toX, pair.toY, pair.x, pair.y, ship, out);
        return true;
      }
    }
    return false;
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
