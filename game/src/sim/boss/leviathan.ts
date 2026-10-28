import { BOSSES } from '../../content/bosses';
import { clamp } from '../../content/curves';
import type { AttackId } from '../../content/types';
import { PLAYER } from '../config';
import type { Field } from '../field';
import { smoothstep, TAU, turnBetween } from '../math';
import { rescale } from '../wrap';
import { dashAttack, fireBolt } from './attacks';
import type { AttackContext, AttackSpec, BossBehaviour, BossPart, BossSetup, BossView, Point } from './behaviour';
import { SerpentTrail } from './serpentTrail';

/** Its body: segments of this radius and HP, each this far along the head's trail from the next. */
export const SEGMENT_COUNT = 8;
export const SEGMENT_RADIUS = 24;
export const SEGMENT_HP = 3;
export const SEGMENT_GAP = 40;
/** The trail notes the head each time it has moved this far, and holds enough of those points to reach past the tail. */
export const TRAIL_STEP = 4;
const TRAIL_CAPACITY = Math.ceil((SEGMENT_COUNT * SEGMENT_GAP) / TRAIL_STEP) + 8;

/** The head's swim: a Lissajous path this far inside the field's edges, never faster than this, units per second. */
export const SWIM_SPEED = 110;
export const SWIM_MARGIN = 90;
/** The path's turns across the field and down it, per lap. */
const SWIM_X_TURNS = 3;
const SWIM_Y_TURNS = 2;
/** Seconds the head takes to ease back onto its path after a dive or a coil. */
export const EASE_SECONDS = 1;
/** Points of a lap searched for the nearest place to rejoin the path. */
const REJOIN_SAMPLES = 256;

export const DIVE_SECONDS = 1;
/** The coil: a ring of this radius round the windup's aim (`coilAim`), run this long, open over this arc where the head was. */
export const COIL_RADIUS = 220;
export const COIL_SECONDS = 2;
export const COIL_OPENING = Math.PI / 3;
/** The head's radius: how far either side of the ring the coil reaches. */
const HEAD_RADIUS = BOSSES.leviathan.radius;
/** The least room a ship that holds still where it was keeps inside the ring, clear of the head. */
const COIL_CLEARANCE = 40;
/**
 * How far in from where the ship was a coil's centre moves at most, to bring its ring onto the field: as far as still
 * leaves a ship that holds still `COIL_CLEARANCE` inside the ring, clear of the head.
 */
export const COIL_NUDGE = COIL_RADIUS - HEAD_RADIUS - PLAYER.radius - COIL_CLEARANCE;
/** Seconds the head takes to swim in or out to the ring, and how far past it the head swims out through the opening. */
const COIL_ENTRY_SECONDS = 0.5;
const COIL_EXIT = 80;
/** How fast the head turns toward a dive's aim through its windup, radians per second. */
const AIM_TURN_RATE = 8;

/** The Leviathan's windups, in seconds. A dive's is long enough for a ship at rest to thrust out of the head's lane. */
const WINDUPS = { dive: 1, spit: 0.5, coil: 0.9 } as const;
export type LeviathanAttack = keyof typeof WINDUPS;
/** Its attacks that move its head, which then follows what their run makes of it. */
const MOVES: ReadonlySet<AttackId> = new Set<AttackId>(['dive', 'coil']);

/** How fast the swim path's phase runs in `field`, radians per second: as fast as keeps the head under `SWIM_SPEED`. */
export const swimRate = (field: Field): number =>
  SWIM_SPEED / Math.hypot(SWIM_X_TURNS * (field.width / 2 - SWIM_MARGIN), SWIM_Y_TURNS * (field.height / 2 - SWIM_MARGIN));

/** Which way across the field the swim path first turns: 1 to the right, -1 to the left, its mirror image. */
export type SwimSide = 1 | -1;

/**
 * Writes into `out`, and returns, the swim path's point at `phase` in `field`, turning first to `side`; phase 0 is at the
 * top, in the middle.
 */
export function swimPoint(field: Field, phase: number, out: Point, side: SwimSide = 1): Point {
  out.x = field.width / 2 + side * (field.width / 2 - SWIM_MARGIN) * Math.sin(SWIM_X_TURNS * phase);
  out.y = field.height / 2 - (field.height / 2 - SWIM_MARGIN) * Math.cos(SWIM_Y_TURNS * phase);
  return out;
}

/**
 * Writes into `out` the centre of a coil round a ship at `ship` in `field`, its aim: where the ship was, moved toward the
 * spot where the whole ring and the head fit inside the field, but no further than `COIL_NUDGE`. A ring round a ship
 * near an edge or a corner so stays mostly on the field, and the ship inside it.
 */
export function coilAim(ship: Readonly<Point>, field: Field, out: Point): void {
  const fit = COIL_RADIUS + HEAD_RADIUS;
  const dx = (field.width < 2 * fit ? field.width / 2 : clamp(ship.x, fit, field.width - fit)) - ship.x;
  const dy = (field.height < 2 * fit ? field.height / 2 : clamp(ship.y, fit, field.height - fit)) - ship.y;
  const share = Math.min(1, COIL_NUDGE / Math.hypot(dx, dy));
  out.x = ship.x + dx * share;
  out.y = ship.y + dy * share;
}

/** How a coil runs, planned as its windup begins: refilled in place. */
export interface CoilPlan {
  /** The bearing, from the ring's centre, of the head as the windup began: the middle of the ring's opening. */
  opening: number;
  /** How far from the centre the head began. */
  from: number;
  /** Which way round the head goes: 1 or -1. */
  turn: number;
  /** Seconds into the coil the head starts round the ring, and starts in or out to it. */
  turnsAt: number;
  movesAt: number;
}

/**
 * Plans a coil about `aim` whose head holds at `head`, against a ship holding still at `ship`, the head having swum the
 * `swimTurn` way round the aim (its sign). The head goes round away from the ship's side, or the way it swam if the
 * ship sits on its line. A head outside the ring swims straight in to it first, never nearer the centre than the ring
 * and so never nearer the ship, which is inside it, and then goes round. A head inside the ring goes round first at its
 * own distance, which only takes it further from the ship, until the ship is a quarter turn or more behind it, and then
 * swims out; from there the ship stays behind it until it is on the ring. So the head never closes on a still ship.
 */
export function planCoil(head: Readonly<Point>, aim: Readonly<Point>, ship: Readonly<Point>, swimTurn: number, plan: CoilPlan): CoilPlan {
  plan.opening = Math.atan2(head.y - aim.y, head.x - aim.x);
  plan.from = Math.hypot(head.x - aim.x, head.y - aim.y);
  const side = turnBetween(plan.opening, Math.atan2(ship.y - aim.y, ship.x - aim.x));
  plan.turn = side > 0 ? -1 : side < 0 ? 1 : swimTurn >= 0 ? 1 : -1;
  const outside = plan.from >= COIL_RADIUS;
  plan.turnsAt = outside ? COIL_ENTRY_SECONDS : 0;
  plan.movesAt = outside ? 0 : (Math.max(0, Math.PI / 2 - Math.abs(side)) / TAU) * COIL_SECONDS;
  return plan;
}

/**
 * Writes into `out`, and returns, where the head is `elapsed` seconds into a coil about `aim` run to `plan`: turning
 * once round the aim from its opening from `plan.turnsAt` to the coil's end, easing from its own distance to the ring
 * over `COIL_ENTRY_SECONDS` from `plan.movesAt`, and swimming out through the opening's near half as the turn ends.
 */
export function coilPoint(plan: Readonly<CoilPlan>, aim: Readonly<Point>, elapsed: number, out: Point): Point {
  const half = COIL_OPENING / 2;
  const sweep = TAU * clamp((elapsed - plan.turnsAt) / (COIL_SECONDS - plan.turnsAt), 0, 1);
  const angle = plan.opening + plan.turn * sweep;
  const ease = smoothstep(clamp((elapsed - plan.movesAt) / COIL_ENTRY_SECONDS, 0, 1));
  const radius = plan.from + (COIL_RADIUS - plan.from) * ease + COIL_EXIT * smoothstep(Math.max(0, sweep - (TAU - half)) / half);
  out.x = aim.x + Math.cos(angle) * radius;
  out.y = aim.y + Math.sin(angle) * radius;
  return out;
}

/** The phase of the swim path's point nearest (x, y), of `REJOIN_SAMPLES` round a lap; the first of equals. */
function nearestPhase(field: Field, side: SwimSide, x: number, y: number, probe: Point): number {
  let best = 0;
  let nearest = Infinity;
  for (let i = 0; i < REJOIN_SAMPLES; i++) {
    const phase = (i / REJOIN_SAMPLES) * TAU;
    swimPoint(field, phase, probe, side);
    const distance = Math.hypot(probe.x - x, probe.y - y);
    if (distance >= nearest) continue;
    best = phase;
    nearest = distance;
  }
  return best;
}

/** The index of the tail-most live segment of a body listed tail first, or -1 with none left. */
export function tailOf(parts: readonly Readonly<BossPart>[]): number {
  for (let i = 0; i < parts.length; i++) if ((parts[i] as BossPart).hp > 0) return i;
  return -1;
}

/** A scratch point for the swim path's points and the nearest-point search; reused. */
const spot: Point = { x: 0, y: 0 };

/**
 * The Leviathan, Dimension 4's boss: a serpent, a head of `BOSSES.leviathan.radius` trailing `SEGMENT_COUNT` segments
 * along the way it has swum (a `SerpentTrail`), the whole body lethal to touch. Its segments are its parts, listed tail
 * first: only the tail-most one left can be hurt, the rest deflect, and each break takes the definition's break damage
 * off the head. The head is shielded until the last segment breaks.
 *
 * The head owns its pose: it swims a Lissajous path inside the field, holds still through every windup, and dives,
 * spits and coils. It never wraps: it moves in plain field coordinates and is never carried across an edge, and its
 * segments lie on its own trail, so none ever jumps. A coil's ring is moved in toward the field (`coilAim`), but round a
 * ship near a corner it can still carry the head past an edge, and it eases back the way it went; everything else keeps
 * it inside the field.
 */
class Leviathan implements BossBehaviour {
  readonly driftSpeed = 0;
  readonly parts: readonly BossPart[];
  readonly attacks: Readonly<Record<LeviathanAttack, AttackSpec>>;
  private readonly trail = new SerpentTrail(TRAIL_CAPACITY, TRAIL_STEP);
  private field: Field;
  /** Which way its swim path turns first, drawn as the fight begins, so seeds differ even on an empty field. */
  private readonly side: SwimSide;
  /** Where the head is: written onto the view every step, so nothing else moves it. */
  private headX = 0;
  private headY = 0;
  /** The bearing the head faces as it arrives: along its trail. */
  private readonly arrivalFacing: number;
  private phase = 0;
  /** Seconds into easing back onto the path from (easeX, easeY); `EASE_SECONDS` once on it. */
  private easeAge = EASE_SECONDS;
  private easeX = 0;
  private easeY = 0;
  /** Whether an attack that moves the head ran last step. */
  private striking = false;
  private lastWindup: AttackId | null = null;
  /** The coil under way, round the view's aim. */
  private readonly coilPlan: CoilPlan = { opening: 0, from: 0, turn: 1, turnsAt: 0, movesAt: 0 };

  constructor(setup: BossSetup) {
    this.field = setup.field;
    this.side = setup.rng.chance(0.5) ? -1 : 1;
    this.parts = Array.from({ length: SEGMENT_COUNT }, () => ({ x: 0, y: 0, px: 0, py: 0, radius: SEGMENT_RADIUS, hp: SEGMENT_HP, maxHp: SEGMENT_HP }));
    this.attacks = {
      dive: dashAttack(WINDUPS.dive, DIVE_SECONDS, HEAD_RADIUS),
      spit: { windup: WINDUPS.spit, active: 0, run: (ctx) => { this.spit(ctx); } },
      coil: { windup: WINDUPS.coil, active: COIL_SECONDS, aim: coilAim, run: (ctx) => { this.coil(ctx); }, threat: { kind: 'ring', radius: COIL_RADIUS, reach: HEAD_RADIUS, around: 'aim' } },
    };
    this.arrive(setup.field);
    const front = this.parts[SEGMENT_COUNT - 1] as BossPart;
    this.arrivalFacing = Math.atan2(this.headY - front.y, this.headX - front.x);
  }

  home(): Readonly<Point> {
    return { x: this.headX, y: this.headY };
  }

  /** Bare once every segment is broken. */
  vulnerable(): boolean {
    return tailOf(this.parts) < 0;
  }

  /** Only the tail-most live segment can be hurt. */
  partVulnerable(index: number): boolean {
    return index === tailOf(this.parts);
  }

  step(ctx: AttackContext): void {
    const { boss } = ctx;
    const field = ctx.arena.field();
    if (field.width !== this.field.width || field.height !== this.field.height) this.refit(boss, field);
    if (boss.state === 'intro') boss.facing = this.arrivalFacing;
    else if (boss.state === 'fighting') {
      this.move(ctx);
      this.turn(ctx);
    }
    boss.x = this.headX;
    boss.y = this.headY;
    this.trail.follow(this.headX, this.headY);
    this.trail.lay(this.headX, this.headY, this.parts, SEGMENT_GAP);
  }

  /** Puts the head at the start of its path, at the top of `field`, its segments trailed behind it the way it swam in. */
  private arrive(field: Field): void {
    // Back along the path far enough for the whole body, in steps of half a unit at most, then forward to the start.
    const step = (swimRate(field) / SWIM_SPEED) * 0.5;
    const need = SEGMENT_COUNT * SEGMENT_GAP + TRAIL_STEP;
    let steps = 0;
    for (let length = 0; length < need; steps++) {
      const { x, y } = swimPoint(field, -steps * step, spot, this.side);
      swimPoint(field, -(steps + 1) * step, spot, this.side);
      length += Math.hypot(spot.x - x, spot.y - y);
    }
    for (let k = steps; k >= 0; k--) {
      swimPoint(field, -k * step, spot, this.side);
      this.trail.follow(spot.x, spot.y);
    }
    this.headX = spot.x;
    this.headY = spot.y;
    this.trail.lay(this.headX, this.headY, this.parts, SEGMENT_GAP);
  }

  /** Moves the head for this step of the fight: as an attack's run left it, held through a windup, or swimming. */
  private move(ctx: AttackContext): void {
    const { boss } = ctx;
    const fresh = boss.windup !== this.lastWindup;
    this.lastWindup = boss.windup;
    if (boss.active !== null && MOVES.has(boss.active)) {
      if (this.striking) {
        this.headX = boss.x;
        this.headY = boss.y;
      } else {
        // It goes active this step, and its run moves the head from the next: from where the head held, not from the
        // view the runner read after its drift, which may have clamped a head left past an edge by a coil.
        this.striking = true;
        ctx.fromX = this.headX;
        ctx.fromY = this.headY;
      }
      return;
    }
    if (this.striking) {
      // Its run has just ended, leaving the head where it put it: from there it eases back onto its path.
      this.striking = false;
      this.headX = boss.x;
      this.headY = boss.y;
      this.rejoin();
      return;
    }
    if (boss.windup !== null) {
      if (fresh && boss.windup === 'coil') this.openCoil(boss, ctx.arena.ship);
      return;
    }
    this.swim(ctx.dt);
  }

  /** Faces the head the way it moved this step; or, through a dive's windup, turns it toward the aim. */
  private turn(ctx: AttackContext): void {
    const { boss, dt } = ctx;
    if (boss.windup === 'dive') {
      const limit = AIM_TURN_RATE * dt;
      boss.facing += clamp(turnBetween(boss.facing, Math.atan2(boss.aim.y - this.headY, boss.aim.x - this.headX)), -limit, limit);
      return;
    }
    const dx = this.headX - boss.px;
    const dy = this.headY - boss.py;
    if (dx !== 0 || dy !== 0) boss.facing = Math.atan2(dy, dx);
  }

  /** Swims `dt` seconds on along the path, easing onto it if it is not there yet. */
  private swim(dt: number): void {
    const { field } = this;
    this.phase = (this.phase + swimRate(field) * dt) % TAU;
    swimPoint(field, this.phase, spot, this.side);
    if (this.easeAge >= EASE_SECONDS) {
      this.headX = spot.x;
      this.headY = spot.y;
      return;
    }
    this.easeAge = Math.min(EASE_SECONDS, this.easeAge + dt);
    const share = smoothstep(this.easeAge / EASE_SECONDS);
    this.headX = this.easeX + (spot.x - this.easeX) * share;
    this.headY = this.easeY + (spot.y - this.easeY) * share;
  }

  /** Starts easing the head back onto its path, at the path's nearest point. */
  private rejoin(): void {
    this.easeX = this.headX;
    this.easeY = this.headY;
    this.easeAge = 0;
    this.phase = nearestPhase(this.field, this.side, this.headX, this.headY, spot);
  }

  /** Plans the coil as its windup begins: about the view's aim, from where the head holds, against where the ship is. */
  private openCoil(boss: Readonly<BossView>, ship: Readonly<Point>): void {
    const rx = this.headX - boss.aim.x;
    const ry = this.headY - boss.aim.y;
    spot.x = this.headX;
    spot.y = this.headY;
    planCoil(spot, boss.aim, ship, rx * Math.sin(boss.facing) - ry * Math.cos(boss.facing), this.coilPlan);
  }

  /** Runs the head round the ring as its plan says (`coilPoint`). */
  private coil(ctx: AttackContext): void {
    coilPoint(this.coilPlan, ctx.boss.aim, ctx.age + ctx.dt, ctx.boss);
  }

  /** Fires a bolt from each live segment, square to the body there, to one side and then the other down its length. */
  private spit(ctx: AttackContext): void {
    const { parts } = this;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as BossPart;
      if (part.hp <= 0) continue;
      const leader: Readonly<Point> = parts[i + 1] ?? ctx.boss;
      fireBolt(ctx, part.x, part.y, Math.atan2(leader.y - part.y, leader.x - part.x) + (i % 2 === 0 ? 1 : -1) * (Math.PI / 2));
    }
  }

  /**
   * Follows a resize: its trail and its ease stretch with the field, as the runner stretches the aim, and a swimming head
   * eases onto the new path.
   */
  private refit(boss: Readonly<BossView>, field: Field): void {
    const old = this.field;
    this.field = field;
    this.trail.rescale(old, field);
    this.headX = boss.x;
    this.headY = boss.y;
    this.easeX = rescale(this.easeX, old.width, field.width);
    this.easeY = rescale(this.easeY, old.height, field.height);
    if (!this.striking) this.rejoin();
  }
}

/** The Leviathan's behaviour, with its attacks spelled out. */
export type LeviathanBehaviour = BossBehaviour & { readonly attacks: Readonly<Record<LeviathanAttack, AttackSpec>> };

/** Makes the Leviathan for one fight. It draws once from the fight's stream, which way its swim turns first; the rest is set by the fight. */
export const createLeviathan = (setup: BossSetup): LeviathanBehaviour => new Leviathan(setup);
