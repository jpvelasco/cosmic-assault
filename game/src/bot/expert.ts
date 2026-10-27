import { clamp } from '../content/curves';
import { MINE } from '../content/foes';
import { BLACK_HOLE, WARP_RIFT } from '../content/hazards';
import type { AttackId } from '../content/types';
import { dashAim, radialShove } from '../sim/boss/attacks';
import type { BossThreat, BossView, Point } from '../sim/boss/behaviour';
import { MAX_SHOVE_SPEED } from '../sim/boss/bossRules';
import { PLAYER, STEP_SECONDS, STICK } from '../sim/config';
import type { Foe } from '../sim/foes/foe';
import { zoneClearance } from '../sim/hazards/dangerZone';
import type { HazardState, PointHazardState, RiftState, ZoneState } from '../sim/hazards/hazard';
import { shipPullAt, type ShipPull } from '../sim/hazards/shipPull';
import { nudge, TAU, turnBetween } from '../sim/math';
import type { Rng } from '../sim/rng';
import { wrapDelta, wrappedDistance } from '../sim/wrap';
import { copyIntent, Hands, idleIntent, type Intent } from './hands';
import { chooseTarget, leadHeading, type Target } from './targeting';
import type { Bot, BotView } from './view';

/** How far ahead the pilot looks for a collision. */
const LOOK_AHEAD_SECONDS = 0.6;
/** Points along the look-ahead it checks, after the present one. */
const SAMPLES = 6;
const SAMPLE_SECONDS = LOOK_AHEAD_SECONDS / SAMPLES;
/** Escape headings it weighs when in danger, evenly spaced. */
const HEADINGS = 16;
/** Clearance, in units between the ship's edge and a threat's, under which it dodges, and over which it calms down again. */
const DANGER = 45;
const CALM = 70;
/** Clearance a predicted point gains per sample ahead: a later, less certain collision weighs less than a near one. */
const SLACK_PER_SAMPLE = 3;
/** The clearance past which a sample counts as no safer, when scoring a dodge. */
const CLEAR_ENOUGH = 120;
/** How much, in clearance units, a dodge prefers to keep the nose on its target. */
const AIM_BIAS = 3;
/**
 * A splitter breaks into fast fragments, so the pilot keeps this much farther from one than from a rock, and holds fire
 * on one nearer than `SPLITTER_SAFE` within `HOLD_FIRE_ARC` radians of its nose.
 */
const SPLITTER_MARGIN = 40;
const SPLITTER_SAFE = 200;
const HOLD_FIRE_ARC = 0.35;
/** A boss's core sends its attacks out from close by, so the pilot keeps this much farther from it too. */
const CORE_MARGIN = 40;
/**
 * A boss's own rocks fly straight and never wrap, so the pilot lets them pass this much nearer than the field's before
 * it counts them as touching: the gaps in a broadside's line and a quake's ring are usable.
 */
const BOSS_ROCK_ALLOWANCE = 35;
/** How far clear of a mine's arm ring it keeps, so it never arms one. */
const ARM_CLEARANCE = 20;
/** It keeps out of a danger zone that is active, or that will be within this many seconds. */
const ZONE_LEAD_SECONDS = 1;
/** It keeps this far clear of a warp rift's mouth, beyond the rim the ship may touch, and so never passes through one. */
const MOUTH_CLEARANCE = 20;
/** It keeps this far clear of a black hole's horizon: the 40 units beyond the ship's contact the escape invariant holds from. */
const HOLE_CLEARANCE = 40;
/** Within this range of an active black hole, the pilot thrusts straight away from it, if that is safe. */
const HOLE_FLEE_RANGE = 260;
/** It goes for a pickup this near that will not expire on the way. */
const PICKUP_REACH = 450;
const PICKUP_MIN_SECONDS = 1;
/** How often a wobbling aim picks a new error. */
const WOBBLE_STEPS = Math.round(0.5 / STEP_SECONDS);
/** A pilot judges afresh every this many steps, at 60 Hz like a player's frames, and holds its intent between. */
const THINK_STEPS = 2;
/** A ship coasting, and one on the stick at full thrust, keep this share of their speed per 60 Hz frame. */
const COAST_DRAG = PLAYER.dragPerFrame60;
const THRUST_DRAG = Math.min(COAST_DRAG + STICK.maxDragReliefFactor * (1 - COAST_DRAG), STICK.maxDrag);
const IDLE: Readonly<Intent> = Object.freeze(idleIntent());
/** The fewest circles a ring threat is laid out as, however wide each is. */
const RING_MIN_CIRCLES = 8;
/** Out of this range of a boss's core, across the field, the pilot closes in, to this far out from it the way it faces. */
const ENGAGE_RANGE = 420;
const STANDOFF = 300;
/** How far inside the field's edges it keeps its station. */
const STATION_INSET = 60;
/** How near the lead its nose must be for it to fire at a boss. */
const BOSS_FIRE_ARC = 0.2;

/** Whether `id` is still on the field among `things`: there, and not spent if it has hit points. */
function onField(things: readonly Readonly<{ id: number; hp?: number }>[], id: number): boolean {
  for (const thing of things) if (thing.id === id) return thing.hp === undefined || thing.hp > 0;
  return false;
}

/** How near a foe it must not come: a mine's arm ring and the clearance it keeps from it, a splitter's spray margin, else its body. */
function foeReach(foe: Readonly<Foe>): number {
  if (foe.kind === 'mine') return MINE.armRadius + ARM_CLEARANCE;
  return foe.radius + (foe.kind === 'splitter' ? SPLITTER_MARGIN : 0);
}

/** Whether `hazard` is a danger zone to keep out of now: active, or starting within `ZONE_LEAD_SECONDS`. */
const zoneToAvoid = (hazard: Readonly<HazardState>): hazard is Readonly<ZoneState> =>
  hazard.type === 'dangerZone' && (hazard.stage === 'active' || hazard.remaining <= ZONE_LEAD_SECONDS);

/** Whether a warp rift is to be kept clear of now: open, or opening within `ZONE_LEAD_SECONDS`. */
const riftToAvoid = (hazard: Readonly<HazardState>): hazard is Readonly<RiftState> =>
  hazard.type === 'warpRift' && (hazard.stage === 'active' || hazard.remaining <= ZONE_LEAD_SECONDS);

/** Whether a black hole's horizon is to be kept clear of now: active, or starting within `ZONE_LEAD_SECONDS`. */
const holeToAvoid = (hazard: Readonly<HazardState>): hazard is Readonly<PointHazardState> =>
  hazard.type === 'blackHole' && (hazard.stage === 'active' || hazard.remaining <= ZONE_LEAD_SECONDS);

/** The active black hole within `HOLE_FLEE_RANGE` of the ship, if there is one. */
function holeNear(view: Readonly<BotView>): Readonly<PointHazardState> | null {
  for (const hazard of view.hazards) {
    if (hazard.type === 'blackHole' && hazard.stage === 'active' && wrappedDistance(view.ship, hazard, view.field) < HOLE_FLEE_RANGE) return hazard;
  }
  return null;
}

/** Whether a splitter is near enough ahead of the nose that breaking it would spray its fragments at the ship. */
function splitterAhead(view: Readonly<BotView>): boolean {
  const { ship, field } = view;
  for (const foe of view.foes) {
    if (foe.kind !== 'splitter' || foe.hp <= 0) continue;
    const dx = wrapDelta(foe.x - ship.x, field.width);
    const dy = wrapDelta(foe.y - ship.y, field.height);
    if (Math.hypot(dx, dy) < SPLITTER_SAFE && Math.abs(turnBetween(ship.angle, Math.atan2(dy, dx))) < HOLD_FIRE_ARC) return true;
  }
  return false;
}

export interface PilotOptions {
  /** The bot's own stream: the only randomness a pilot draws. */
  readonly rng: Rng;
  /** The chance it dodges at all, rolled once as each danger episode starts; at 1 it always dodges and draws nothing. */
  readonly dodgeChance?: number;
  /**
   * The chance it dodges a boss's telegraphed attack, rolled once as its windup begins; at 1 it always dodges and draws
   * nothing. The roll decides for what the attack threatens with: its lane and the boss's bodies while it lasts, and the
   * rocks and drones it sends out for as long as they fly. Everything else is judged on the episode's roll.
   */
  readonly telegraphDodgeChance?: number;
  /** Radians its aim strays either way, redrawn every half second; at 0 it aims true and draws nothing. */
  readonly aimWobble?: number;
}

/**
 * The expert's judgement, made at 60 Hz. It predicts where each threat (rock, foe, boss core and parts, and the lane a
 * boss's telegraphed attack may charge down) will be over the next 0.6 s, across the wrap, against where the ship will
 * be: coasting, or thrusting each of 16 ways, a gravity well's pull included. Coasting into danger, it thrusts the
 * safest way; otherwise it goes for a pickup if the way there is safe, or turns to lead its target, firing unless that
 * would break a splitter in its face.
 */
export class Pilot {
  private readonly rng: Rng;
  private readonly dodgeChance: number;
  private readonly telegraphDodgeChance: number;
  private readonly aimWobble: number;
  /** Threats, relative to the ship: offset, velocity and the centre distance at which they touch it. */
  private readonly tx: number[] = [];
  private readonly ty: number[] = [];
  private readonly tvx: number[] = [];
  private readonly tvy: number[] = [];
  private readonly reach: number[] = [];
  /** A boss's bodies and its strike lane: worth keeping out of even while the ship cannot be hurt. */
  private readonly solid: boolean[] = [];
  /** Whether a threat is measured across the wrap; a bolt, which never wraps, is measured straight across the field. */
  private readonly wraps: boolean[] = [];
  /** For a threat a telegraphed attack made, whether that attack was to be dodged; null for any other threat. */
  private readonly rolled: (boolean | null)[] = [];
  private count = 0;
  /** The danger zones to keep out of, judged by their rectangles rather than as circles; refilled per judgement. */
  private readonly zones: Readonly<ZoneState>[] = [];
  /** Seconds until the ship can be hurt by anything but a solid threat. */
  private harmlessFor = 0;
  /** What the last `predict` found: the least clearance, slack included, and the mean of each sample's capped least. */
  private least = 0;
  private mean = 0;
  /** The `rolled` of the threat that came nearest in the last `predict`. */
  private nearestRolled: boolean | null = null;
  /** Where the ship would be at each sample, relative to now. */
  private readonly sx = new Float64Array(SAMPLES + 1);
  private readonly sy = new Float64Array(SAMPLES + 1);
  private readonly target: Target = { x: 0, y: 0, vx: 0, vy: 0, wraps: true, weakPoint: false };
  private readonly last = idleIntent();
  private inDanger = false;
  /** Whether it dodges in the danger episode under way, and in the boss attack under way. */
  private dodging = true;
  private dodgingStrike = true;
  /** The rocks and drones telegraphed attacks sent out, by id, and whether each attack was to be dodged. */
  private readonly spawnIds: number[] = [];
  private readonly spawnDodging: boolean[] = [];
  /** The highest rock or foe id seen so far: one above it is new. */
  private idMark = 0;
  private wobble = 0;
  private nextWobbleAt = 0;
  private steps = 0;
  /** The boss's current attack and its threat, and when its windup began; null between attacks. */
  private strike: AttackId | null = null;
  private strikeThreat: Readonly<BossThreat> | null = null;
  private strikeAt = 0;
  /** Where a lane threat ends; reused. */
  private readonly laneEnd: Point = { x: 0, y: 0 };
  /** Seconds until a boss's shove lands, from now; infinite when none is coming. */
  private shoveIn = Infinity;
  /** The predicted ship's velocity, and a shove on it; reused. */
  private readonly motion = { vx: 0, vy: 0 };
  private readonly shove: Point = { x: 0, y: 0 };
  /** The hazards' predicted pull on the ship, refilled per prediction. */
  private readonly pull: ShipPull = { x: 0, y: 0 };

  constructor(options: PilotOptions) {
    this.rng = options.rng;
    this.dodgeChance = options.dodgeChance ?? 1;
    this.telegraphDodgeChance = options.telegraphDodgeChance ?? 1;
    this.aimWobble = options.aimWobble ?? 0;
  }

  /** Writes this step's intent into `out`: a fresh judgement every `THINK_STEPS` steps, the last one held between. */
  plan(view: Readonly<BotView>, out: Intent): Intent {
    this.trackStrike(view);
    if (this.steps % THINK_STEPS === 0 || view.status !== 'playing') this.think(view, this.last);
    this.steps++;
    copyIntent(this.last, out);
    return out;
  }

  private think(view: Readonly<BotView>, out: Intent): void {
    if (view.status !== 'playing') {
      copyIntent(IDLE, out);
      return;
    }
    const aim = this.aimHeading(view);
    this.gatherThreats(view);
    out.fire = aim !== null && this.mayFire(view, aim);
    out.heading = aim;
    out.thrust = false;
    this.predict(view, null);
    if (this.danger() && this.willDodge()) {
      this.dodge(view, aim ?? view.ship.angle, out);
      return;
    }
    if (this.fleeHole(view, out)) return;
    if (!this.seekPickup(view, out)) this.closeIn(view, out);
  }

  /** Thrusts straight away from an active black hole within `HOLE_FLEE_RANGE`, if that is safe; true if it did. */
  private fleeHole(view: Readonly<BotView>, out: Intent): boolean {
    const hole = holeNear(view);
    if (hole === null) return false;
    const { ship } = view;
    return this.steer(view, 2 * ship.x - hole.x, 2 * ship.y - hole.y, out);
  }

  /**
   * Whether to fire with its lead at `aim`: not into a splitter in its face, and at a boss only with its nose on the
   * lead, so that no shot is spent on the hull.
   */
  private mayFire(view: Readonly<BotView>, aim: number): boolean {
    if (splitterAhead(view)) return false;
    return this.target.wraps || Math.abs(turnBetween(view.ship.angle, aim)) < BOSS_FIRE_ARC;
  }

  /** Whether coasting is in danger, from the last `predict`; it rolls whether to dodge as each danger starts. */
  private danger(): boolean {
    if (this.inDanger) {
      this.inDanger = this.least < CALM;
    } else if (this.least < DANGER) {
      this.inDanger = true;
      this.dodging = this.roll(this.dodgeChance);
    }
    return this.inDanger;
  }

  /** Whether it dodges the danger it is in: as it rolled for the attack that made the nearest threat, else for the episode. */
  private willDodge(): boolean {
    return this.nearestRolled ?? this.dodging;
  }

  /** True with `chance`, drawn from the bot's stream; a sure thing draws nothing. */
  private roll(chance: number): boolean {
    return chance >= 1 || this.rng.chance(chance);
  }

  /** Thrusts the safest way, the nose kept near `aim` among equals; leaves `out` coasting if that is safest. */
  private dodge(view: Readonly<BotView>, aim: number, out: Intent): void {
    let best = this.mean;
    for (let i = 0; i < HEADINGS; i++) {
      const heading = (i * TAU) / HEADINGS;
      this.predict(view, heading);
      const score = this.mean + AIM_BIAS * Math.cos(turnBetween(aim, heading));
      if (score > best) {
        best = score;
        out.heading = heading;
        out.thrust = true;
      }
    }
  }

  /** Steers for the nearest pickup in reach if thrusting that way is safe, and says whether it does; leaves `out` aiming otherwise. */
  private seekPickup(view: Readonly<BotView>, out: Intent): boolean {
    const { ship, field } = view;
    let nearest = PICKUP_REACH;
    let goal: Readonly<Point> | null = null;
    for (const pickup of view.pickups) {
      const distance = wrappedDistance(ship, pickup, field);
      if (distance >= nearest || pickup.expiresIn < PICKUP_MIN_SECONDS) continue;
      nearest = distance;
      goal = pickup;
    }
    return goal !== null && this.steer(view, goal.x, goal.y, out);
  }

  /**
   * Out of range of a boss in the fight, across the field, steers for a station `STANDOFF` out from its core the way it
   * faces, kept inside the field: in front of a weak point that turns to face the ship, and near enough for every shot
   * to reach it without coming round the wrap.
   */
  private closeIn(view: Readonly<BotView>, out: Intent): void {
    const { ship, field, boss } = view;
    if (boss?.state !== 'fighting' || Math.hypot(boss.x - ship.x, boss.y - ship.y) <= ENGAGE_RANGE) return;
    const x = clamp(boss.x + Math.cos(boss.facing) * STANDOFF, STATION_INSET, field.width - STATION_INSET);
    const y = clamp(boss.y + Math.sin(boss.facing) * STANDOFF, STATION_INSET, field.height - STATION_INSET);
    this.steer(view, x, y, out);
  }

  /** Thrusts toward (x, y) by the shortest way if that is safe, and says whether it does; leaves `out` alone otherwise. */
  private steer(view: Readonly<BotView>, x: number, y: number, out: Intent): boolean {
    const { ship, field } = view;
    const heading = Math.atan2(wrapDelta(y - ship.y, field.height), wrapDelta(x - ship.x, field.width));
    this.predict(view, heading);
    if (this.least < CALM) return false;
    out.heading = heading;
    out.thrust = true;
    return true;
  }

  /** The heading that leads the chosen target, plus any wobble; null with nothing to shoot. */
  private aimHeading(view: Readonly<BotView>): number | null {
    if (this.aimWobble > 0 && this.steps >= this.nextWobbleAt) {
      this.wobble = this.rng.range(-this.aimWobble, this.aimWobble);
      this.nextWobbleAt = this.steps + WOBBLE_STEPS;
    }
    if (!chooseTarget(view, this.target)) return null;
    return leadHeading(view, this.target) + this.wobble;
  }

  /**
   * Notes a boss attack as its windup begins, with its threat and when it began, and rolls whether to dodge it; and
   * forgets it once the attack is over; and while an attack that shoves winds up, when its shove will land.
   */
  private trackStrike(view: Readonly<BotView>): void {
    // First, while the attack that ran last step is still remembered: an attack with no active time (a launch, a quake,
    // a broadside) sends out its drones or rocks on the step it ends, so they first show in a view with no attack on.
    this.trackSpawns(view);
    const boss = view.boss;
    const attack = boss === null ? null : (boss.windup ?? boss.active);
    if (attack === null) {
      this.strike = this.strikeThreat = null;
    } else if (this.strike === null) {
      this.strike = attack;
      this.strikeThreat = boss?.threat ?? null;
      this.strikeAt = view.elapsed;
      this.dodgingStrike = this.roll(this.telegraphDodgeChance);
    }
    const threat = this.strikeThreat;
    const windingUp = boss !== null && boss.windup !== null;
    this.shoveIn = windingUp && threat?.kind === 'shove' ? Math.max(0, this.strikeAt + threat.windup - view.elapsed) : Infinity;
  }

  /**
   * Forgets the attacks' rocks and drones that have left the field, and notes the new ones the attack under way sends
   * out, with its roll: the foes and rocks the sim marks as an attack's as it makes them (never a rock's fragments).
   */
  private trackSpawns(view: Readonly<BotView>): void {
    const { spawnIds, spawnDodging } = this;
    let kept = 0;
    for (let i = 0; i < spawnIds.length; i++) {
      const id = spawnIds[i] ?? 0;
      if (!onField(view.foes, id) && !onField(view.asteroids, id) && !onField(view.bolts, id)) continue;
      spawnIds[kept] = id;
      spawnDodging[kept++] = spawnDodging[i] ?? true;
    }
    spawnIds.length = spawnDodging.length = kept;
    let mark = this.idMark;
    for (const foe of view.foes) {
      if (foe.id <= this.idMark) continue;
      mark = Math.max(mark, foe.id);
      if (foe.fromAttack) this.noteSpawn(foe.id);
    }
    for (const rock of view.asteroids) {
      if (rock.id <= this.idMark) continue;
      mark = Math.max(mark, rock.id);
      if (rock.fromAttack === true) this.noteSpawn(rock.id);
    }
    for (const bolt of view.bolts) {
      if (bolt.id <= this.idMark) continue;
      mark = Math.max(mark, bolt.id);
      if (bolt.fromAttack) this.noteSpawn(bolt.id);
    }
    this.idMark = mark;
  }

  private noteSpawn(id: number): void {
    this.spawnIds.push(id);
    this.spawnDodging.push(this.dodgingStrike);
  }

  /** The roll of the attack that sent out rock or drone `id`, or null for one no attack made. Public so tests can read what a fight tagged. */
  attackRoll(id: number): boolean | null {
    const at = this.spawnIds.indexOf(id);
    return at < 0 ? null : (this.spawnDodging[at] ?? null);
  }

  /** Lists every threat that could come near the ship over the look-ahead, relative to it. */
  private gatherThreats(view: Readonly<BotView>): void {
    this.count = 0;
    const { ship, boss } = view;
    this.harmlessFor = ship.invulnerable ? ship.invulnerableFor : 0;
    for (const rock of view.asteroids) {
      const allowance = boss !== null && rock.transient === true ? BOSS_ROCK_ALLOWANCE : 0;
      this.addThreat(view, rock.x, rock.y, rock.vx, rock.vy, rock.radius, false, this.attackRoll(rock.id), allowance);
    }
    for (const foe of view.foes) if (foe.hp > 0) this.addThreat(view, foe.x, foe.y, foe.vx, foe.vy, foeReach(foe), false, this.attackRoll(foe.id));
    // Bolts pass out of the field and never wrap: one is judged where it really flies, not across the seam.
    for (const bolt of view.bolts) this.addThreat(view, bolt.x, bolt.y, bolt.vx, bolt.vy, bolt.radius, false, this.attackRoll(bolt.id), 0, false);
    this.zones.length = 0;
    for (const hazard of view.hazards) {
      if (zoneToAvoid(hazard)) this.zones.push(hazard);
      else if (riftToAvoid(hazard)) this.addMouths(view, hazard);
      else if (holeToAvoid(hazard)) this.addThreat(view, hazard.x, hazard.y, 0, 0, BLACK_HOLE.horizon + HOLE_CLEARANCE, true);
    }
    if (boss === null || boss.state === 'dying' || boss.state === 'down') return;
    this.addBody(view, boss, boss.radius + CORE_MARGIN);
    for (const part of boss.parts) if (part.hp > 0) this.addBody(view, part, part.radius);
    const threat = this.strikeThreat;
    if (threat?.kind === 'lane') this.addLane(view, boss, threat.reach);
    else if (threat?.ring !== undefined) this.addRing(view, boss, threat.ring, threat.reach);
  }

  /** Both mouths of a warp rift, as circles the ship keeps out of: a body that touches one is carried through it. */
  private addMouths(view: Readonly<BotView>, rift: Readonly<RiftState>): void {
    const reach = WARP_RIFT.radius + MOUTH_CLEARANCE;
    this.addThreat(view, rift.x, rift.y, 0, 0, reach, false);
    this.addThreat(view, rift.toX, rift.toY, 0, 0, reach, false);
  }

  /**
   * A ring of `ring.radius` about the core, or about the windup's aim, as circles `reach` across no more than a reach
   * apart: a telegraphed attack may sweep the boss's parts, or its body, round it.
   */
  private addRing(view: Readonly<BotView>, boss: Readonly<BossView>, ring: NonNullable<BossThreat['ring']>, reach: number): void {
    const cx = ring.around === 'core' ? boss.x : boss.aim.x;
    const cy = ring.around === 'core' ? boss.y : boss.aim.y;
    const circles = Math.max(RING_MIN_CIRCLES, Math.ceil((TAU * ring.radius) / reach));
    for (let i = 0; i < circles; i++) {
      const angle = (i * TAU) / circles;
      this.addThreat(view, cx + Math.cos(angle) * ring.radius, cy + Math.sin(angle) * ring.radius, 0, 0, reach, true, this.dodgingStrike);
    }
  }

  /**
   * The lane from the core to the windup's aim, as circles `radius` across no more than a radius apart: a telegraphed
   * attack may send the core, or its shards, down it. The lane ends where a core dashing at the aim would stop
   * (`dashAim`): at the aim itself for a dash, whose own aim already stops there. For any other lane, shards that fly on
   * past the aim or bolts that converge on it, that end is an approximation the pilot keeps: it is the one it has always
   * judged them by.
   */
  private addLane(view: Readonly<BotView>, boss: Readonly<BossView>, radius: number): void {
    const end = dashAim(boss.aim, view.field, boss.radius, this.laneEnd);
    const dx = end.x - boss.x;
    const dy = end.y - boss.y;
    const circles = Math.max(1, Math.ceil(Math.hypot(dx, dy) / radius));
    for (let i = 1; i <= circles; i++) this.addThreat(view, boss.x + (dx * i) / circles, boss.y + (dy * i) / circles, 0, 0, radius, true, this.dodgingStrike);
  }

  /**
   * A solid boss body, its velocity read from its pose before the latest step: judged on the attack's roll while one is
   * under way, a shard in a volley say, and on the episode's between attacks.
   */
  private addBody(view: Readonly<BotView>, body: Readonly<{ x: number; y: number; px: number; py: number }>, radius: number): void {
    this.addThreat(view, body.x, body.y, (body.x - body.px) / STEP_SECONDS, (body.y - body.py) / STEP_SECONDS, radius, true, this.strike === null ? null : this.dodgingStrike);
  }

  /**
   * Lists a threat, unless it is too far away to come within `CLEAR_ENOUGH` of the ship over the look-ahead. One that
   * `wraps` is measured across the wrap; one that does not (a bolt), straight across the field.
   */
  private addThreat(view: Readonly<BotView>, x: number, y: number, vx: number, vy: number, radius: number, solid: boolean, rolled: boolean | null = null, allowance = 0, wraps = true): void {
    const { ship, field } = view;
    const dx = wraps ? wrapDelta(x - ship.x, field.width) : x - ship.x;
    const dy = wraps ? wrapDelta(y - ship.y, field.height) : y - ship.y;
    const closing = (Math.hypot(vx, vy) + PLAYER.maxSpeed) * LOOK_AHEAD_SECONDS;
    // The allowance comes off the distance at which it counts as touching the ship.
    const touching = radius - allowance;
    if (Math.hypot(dx, dy) - touching - PLAYER.radius > closing + CLEAR_ENOUGH) return;
    const i = this.count++;
    this.tx[i] = dx;
    this.ty[i] = dy;
    this.tvx[i] = vx;
    this.tvy[i] = vy;
    this.reach[i] = touching + PLAYER.radius;
    this.solid[i] = solid;
    this.wraps[i] = wraps;
    this.rolled[i] = rolled;
  }

  /**
   * Scores coasting (null) or thrusting along `heading` over the look-ahead into `least` and `mean`: the clearance
   * between the ship and each threat at each sample, a later sample given a little slack, and a threat that cannot
   * hurt the ship yet skipped.
   */
  private predict(view: Readonly<BotView>, heading: number | null): void {
    this.predictShip(view, heading);
    const { width, height } = view.field;
    const { tx, ty, tvx, tvy, reach, solid, wraps, sx, sy } = this;
    let least = Infinity;
    let total = 0;
    let nearest = -1;
    for (let k = 0; k <= SAMPLES; k++) {
      const t = k * SAMPLE_SECONDS;
      const harmless = t < this.harmlessFor;
      let sample = Infinity;
      let who = -1;
      for (let i = 0; i < this.count; i++) {
        if (harmless && solid[i] !== true) continue;
        const dx = (tx[i] ?? 0) + (tvx[i] ?? 0) * t - (sx[k] ?? 0);
        const dy = (ty[i] ?? 0) + (tvy[i] ?? 0) * t - (sy[k] ?? 0);
        const clearance = (wraps[i] === false ? Math.hypot(dx, dy) : Math.hypot(wrapDelta(dx, width), wrapDelta(dy, height))) - (reach[i] ?? 0);
        if (clearance < sample) {
          sample = clearance;
          who = i;
        }
      }
      if (!harmless) {
        for (const zone of this.zones) {
          const clearance = zoneClearance(view.field, zone, view.ship.x + (sx[k] ?? 0), view.ship.y + (sy[k] ?? 0)) - PLAYER.radius;
          if (clearance < sample) {
            sample = clearance;
            who = -1;
          }
        }
      }
      if (sample + k * SLACK_PER_SAMPLE < least) {
        least = sample + k * SLACK_PER_SAMPLE;
        nearest = who;
      }
      if (k > 0) total += Math.min(sample, CLEAR_ENOUGH);
    }
    this.least = least;
    this.mean = total / SAMPLES;
    this.nearestRolled = nearest < 0 ? null : (this.rolled[nearest] ?? null);
  }

  /**
   * Fills the ship's predicted offsets: a coarse copy of its physics, with drag, thrust, the speed cap, the force
   * fields' pull and a boss's coming shove.
   */
  private predictShip(view: Readonly<BotView>, heading: number | null): void {
    const { ship, hazards, boss } = view;
    const drag = Math.pow(heading === null ? COAST_DRAG : THRUST_DRAG, 60 * SAMPLE_SECONDS);
    let ax = heading === null ? 0 : Math.cos(heading) * PLAYER.thrust;
    let ay = heading === null ? 0 : Math.sin(heading) * PLAYER.thrust;
    // The hazards' pull, summed and capped exactly as the sim applies it, as an acceleration.
    const pull = shipPullAt(hazards, ship.x, ship.y, 1, this.pull);
    ax += pull.x;
    ay += pull.y;
    const { motion, shove, strikeThreat: push } = this;
    motion.vx = ship.vx;
    motion.vy = ship.vy;
    let x = 0;
    let y = 0;
    for (let k = 1; k <= SAMPLES; k++) {
      if (boss !== null && push !== null && this.shoveIn < k * SAMPLE_SECONDS && this.shoveIn >= (k - 1) * SAMPLE_SECONDS) {
        radialShove(boss, push.speed, push.reach, ship.x + x, ship.y + y, shove);
        nudge(motion, shove.x, shove.y, MAX_SHOVE_SPEED);
      }
      let vx = motion.vx * drag + ax * SAMPLE_SECONDS;
      let vy = motion.vy * drag + ay * SAMPLE_SECONDS;
      const speed = Math.hypot(vx, vy);
      if (speed > PLAYER.maxSpeed) {
        vx *= PLAYER.maxSpeed / speed;
        vy *= PLAYER.maxSpeed / speed;
      }
      motion.vx = vx;
      motion.vy = vy;
      x += vx * SAMPLE_SECONDS;
      y += vy * SAMPLE_SECONDS;
      this.sx[k] = x;
      this.sy[k] = y;
    }
  }
}

/** The expert: its pilot's intents, acted on at once. */
export function createExpert(rng: Rng): Bot {
  const pilot = new Pilot({ rng });
  const hands = new Hands();
  const intent = idleIntent();
  return { decide: (view) => hands.apply(pilot.plan(view, intent), view.ship.angle) };
}
