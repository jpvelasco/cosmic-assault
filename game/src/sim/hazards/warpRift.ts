import { clamp } from '../../content/curves';
import { MIN_WINDUP_SECONDS } from '../../content/pacingRules';
import { BLACK_HOLE, HAZARD_RULES, WARP_RIFT } from '../../content/hazards';
import { MINE } from '../../content/foes';
import type { GalaxyEvent } from '../../content/types';
import { ASTEROID, PLAYER } from '../config';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Ship } from '../ship';
import { rescale, wrapDelta, wrapPosition } from '../wrap';
import { clearSpots } from './dangerZone';
import type { Bodies, Circle, Hazard, HazardSetup, HazardState, RiftState } from './hazard';
import { HazardSchedule, ScheduledHazard } from './schedule';

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

/** A spot a mouth may take. */
type Spot = { x: number; y: number };

/** A pair of mouths, as the schedule holds it: one hazard for both, its mouths at (x, y) and (toX, toY). */
interface Pair extends RiftState {
  stage: HazardState['stage'];
  x: number;
  y: number;
  toX: number;
  toY: number;
  remaining: number;
}

/**
 * The keep-out rings a mouth's rim keeps out of while a black hole is in play, most preferred first: a body's exit from a
 * mouth lands `WARP_RIFT.radius + body + EXIT_GAP` out of its centre, so a mouth whose rim lies `exit + PLAYER.radius +
 * EXIT_GAP` from the hole lets a ship heading straight in leave `exit` from it. The first rung's exit is the reach it survives
 * from; the fallback's is for a crowded field.
 */
const HOLE_RUNGS: readonly number[] = [BLACK_HOLE.exitReach, BLACK_HOLE.exitFallback].map((exit) => exit + PLAYER.radius + EXIT_GAP);

/** The id the ship rests under: rocks and foes take ids from the arena, which start at 1. */
const SHIP_KEY = 0;

/** A body the rift may carry: its place, velocity and previous pose, which a jump resets. */
interface Mover {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
}

/** Whether the body centred at `body`, with reach `reach`, lies within it of (x, y) across the wrap. */
const near = (field: Field, body: Mover, x: number, y: number, reach: number): boolean =>
  Math.hypot(wrapDelta(x - body.x, field.width), wrapDelta(y - body.y, field.height)) < reach;

/**
 * Whether `body` (of `radius`) touches the ship now, or within `seconds` on straight-line motion from both. The offset is
 * measured across the wrap, as everything else is.
 */
function touchesWithin(field: Field, ship: Readonly<Ship>, body: Mover, radius: number, seconds: number): boolean {
  const dx = wrapDelta(body.x - ship.x, field.width);
  const dy = wrapDelta(body.y - ship.y, field.height);
  const rvx = body.vx - ship.vx;
  const rvy = body.vy - ship.vy;
  const speed2 = rvx * rvx + rvy * rvy;
  const t = speed2 > 0 ? clamp(-(dx * rvx + dy * rvy) / speed2, 0, seconds) : 0;
  return Math.hypot(dx + rvx * t, dy + rvy * t) < radius + PLAYER.radius;
}

/**
 * A galaxy's warp rifts, one event at a time: each shows `min(intensity, 2)` pairs of mouths as a warning for its
 * telegraph, then the pairs are open for their length. A body whose edge reaches an open mouth (`radius` plus its own)
 * leaves by the paired mouth, along its velocity and just outside it, with its previous pose reset so nothing streaks.
 * A body leaves at most once a step. A jump that leaves the ship touching a body, or about to within a windup, grants the
 * ship its invulnerability for that long. It never strikes. Mouths keep clear of the field's centre, the ship and the HUD
 * and thumb corners, and of each other across pairs (`MOUTH_SPACING`), and sit at least `apart` of the field's width
 * from their pair: placed from their own stream. While a black hole is in play they also keep out of its reach, on the
 * first of `HOLE_RUNGS` that leaves room, and a pair with room on neither is not placed.
 */
export class WarpRifts extends ScheduledHazard<Pair> implements Hazard {
  private readonly rng: Rng;
  private readonly nextId: () => number;
  private readonly keepOuts: (field: Field) => readonly Circle[];
  private readonly inPlay: () => readonly Readonly<HazardState>[];
  /** The schedule, holding the pairs warning or open: none, or up to two. */
  protected readonly schedule: HazardSchedule<Pair>;
  /** The galaxy's seconds as of the last step. */
  private elapsed = 0;
  /** Bodies that have jumped, by id, and the seconds each may jump again at: a body rests `WARP_RIFT.rest` after a jump. */
  private readonly rested = new Map<number, number>();

  constructor({ events, rng, nextId, keepOuts, inPlay }: HazardSetup) {
    super();
    this.rng = rng;
    this.nextId = nextId;
    this.keepOuts = keepOuts;
    this.inPlay = inPlay;
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

  override step(elapsed: number, field: Field, out: SimEvent[]): void {
    this.elapsed = elapsed;
    super.step(elapsed, field, out);
  }

  /**
   * Carries every body that reaches an open mouth to the other one of its pair, the ship first. A jump that leaves the ship
   * touching a body, or about to, grants the ship its grace: the ship's own jump checks every body, a body's jump checks
   * that body. A ship's jump also checks the hostile bolts and the armed mines (a blast within the windup) for the same.
   */
  carry(bodies: Bodies, out: SimEvent[]): void {
    const { field } = this;
    if (field === null || !this.anyOpen()) return;
    if (this.rested.size > 0) for (const [id, until] of this.rested) if (until <= this.elapsed) this.rested.delete(id);
    const { ship } = bodies;
    const shipJumped = this.carryBody(field, ship, PLAYER.radius, SHIP_KEY, true, out);
    for (const rock of bodies.rocks) this.carryOther(field, ship, rock, rock.radius, rock.id, shipJumped, true, out);
    // A phaser that is warning is on its way to its blink spot: carrying it would leave its blink spot where it is not.
    for (const foe of bodies.foes.list) {
      const jumped = this.carryOther(field, ship, foe, foe.radius, foe.id, shipJumped, !(foe.kind === 'phaser' && foe.charging), out);
      // A charging mine that blasts within the windup reaches the ship by its blast radius, whether the mine or the ship jumped.
      if ((shipJumped || jumped) && foe.kind === 'mine' && foe.charging && foe.timer <= MIN_WINDUP_SECONDS) this.grace(field, ship, foe, MINE.blastRadius, foe.timer);
    }
    if (!shipJumped || bodies.bolts === null) return;
    for (const bolt of bodies.bolts.list) this.grace(field, ship, bolt, bolt.radius, MIN_WINDUP_SECONDS);
  }

  /** Whether a pair is open: with none, nothing jumps, and the rests left to run wait for the next. */
  private anyOpen(): boolean {
    for (const pair of this.schedule.live) if (pair.stage === 'active') return true;
    return false;
  }

  /**
   * Warns of the next pairs an event shows: `min(intensity, 2)` of them, each placed clear of the others by `place`. The
   * spots for each rung of the hole's ladder (or for no rung, with no hole in play) are found once per warning.
   */
  private warn(event: GalaxyEvent, elapsed: number, field: Field, into: Pair[], out: SimEvent[]): void {
    const circles = this.keepOuts(field);
    const hole = this.inPlay().find((h) => h.type === 'blackHole') ?? null;
    const rungs: readonly (number | null)[] = hole === null ? [null] : HOLE_RUNGS;
    const layouts = rungs.map((reach) => {
      const keepOut = reach === null || hole === null ? circles : [...circles, { x: hole.x, y: hole.y, r: reach }];
      // A mouth keeps out of every circle by its own radius, and of the HUD and thumb corners by its drawn radius, so a
      // swirl stays out from under them, or else by its hitbox radius alone.
      const spots = (corners: number): Spot[] => clearSpots(field, keepOut, { inset: WARP_RIFT.inset, reach: WARP_RIFT.radius, corners });
      return { drawn: spots(WARP_RIFT.drawn), hitbox: spots(WARP_RIFT.radius) };
    });
    const count = Math.min(event.intensity, WARP_RIFT.maxPairs);
    for (let i = 0; i < count; i++) {
      const pair = this.placeOnLadder(elapsed, event, field, layouts, into);
      if (pair === null) continue;
      into.push(pair);
      out.push({ type: 'riftWarning', id: pair.id, x: pair.x, y: pair.y, toX: pair.toX, toY: pair.toY });
    }
  }

  /**
   * A pair placed on the first rung of `layouts` that fits it, each rung tried first on the spots whose corner clearance is
   * the drawn radius, then on those cleared by the hitbox radius only. A pair that fits no rung is dropped: no pair is ever
   * placed closer than `MOUTH_SPACING`.
   */
  private placeOnLadder(elapsed: number, event: GalaxyEvent, field: Field, layouts: readonly { drawn: readonly Spot[]; hitbox: readonly Spot[] }[], placed: readonly Pair[]): Pair | null {
    for (const { drawn, hitbox } of layouts) {
      const pair = this.place(elapsed, event, field, drawn, placed) ?? this.place(elapsed, event, field, hitbox, placed);
      if (pair !== null) return pair;
    }
    return null;
  }

  /**
   * A pair drawn from the clear `spots`: its first mouth from those at least `MOUTH_SPACING` from every mouth already
   * placed, its second from those also `apart` of the field's width from the first. Null if no pair fits.
   */
  private place(elapsed: number, event: GalaxyEvent, field: Field, spots: readonly { x: number; y: number }[], placed: readonly Pair[]): Pair | null {
    const far = WARP_RIFT.apart * field.width;
    const free = spots.filter((s) => placed.every((p) => Math.hypot(s.x - p.x, s.y - p.y) >= MOUTH_SPACING && Math.hypot(s.x - p.toX, s.y - p.toY) >= MOUTH_SPACING));
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

  /** Carries a rock or foe, then grants the ship its grace if this jump, or the ship's, leaves them touching it; true if it jumped. */
  private carryOther(field: Field, ship: Readonly<Ship>, body: Mover, radius: number, id: number, shipJumped: boolean, carriable: boolean, out: SimEvent[]): boolean {
    const jumped = carriable && this.carryBody(field, body, radius, id, false, out);
    if (shipJumped || jumped) this.grace(field, ship, body, radius, MIN_WINDUP_SECONDS);
    return jumped;
  }

  /**
   * Sends `body` (keyed `id`) out of the other mouth of the first open pair it reaches, once, and not again until it has
   * rested; true if it jumped.
   */
  private carryBody(field: Field, body: Mover, radius: number, id: number, ship: boolean, out: SimEvent[]): boolean {
    if ((this.rested.get(id) ?? -Infinity) > this.elapsed) return false;
    const reach = WARP_RIFT.radius + radius;
    for (const pair of this.schedule.live) {
      if (pair.stage !== 'active') continue;
      if (near(field, body, pair.x, pair.y, reach)) {
        this.jump(pair, field, body, radius, pair.x, pair.y, pair.toX, pair.toY, ship, out);
      } else if (near(field, body, pair.toX, pair.toY, reach)) {
        this.jump(pair, field, body, radius, pair.toX, pair.toY, pair.x, pair.y, ship, out);
      } else continue;
      this.rested.set(id, this.elapsed + WARP_RIFT.rest);
      return true;
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

  /** Stretches both of the pair's mouths to the new field. */
  protected override rescaleState(pair: Pair, old: Field, field: Field): void {
    super.rescaleState(pair, old, field);
    pair.toX = rescale(pair.toX, old.width, field.width);
    pair.toY = rescale(pair.toY, old.height, field.height);
  }

  /** Grants the ship its invulnerability for a windup if `body` (of `radius`) reaches it within `seconds`. */
  private grace(field: Field, ship: Ship, body: Mover, radius: number, seconds: number): void {
    if (!touchesWithin(field, ship, body, radius, seconds)) return;
    ship.invulnerable = true;
    ship.invulnerableFor = Math.max(ship.invulnerableFor, MIN_WINDUP_SECONDS);
  }
}
