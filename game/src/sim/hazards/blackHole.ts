import { FOES } from '../../content/foes';
import { BLACK_HOLE, HAZARD_RULES, WARP_RIFT } from '../../content/hazards';
import type { Foe } from '../foes/foe';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { nudge, type Point } from '../math';
import { clearSpot, respawnBand, RESPAWN_MARGIN, type RespawnPart } from '../respawn';
import { HazardSchedule } from './schedule';
import type { ZoneBox } from './dangerZone';
import type { Bodies, Hazard, HazardSetup, HazardState, PointHazardState, Pullable } from './hazard';

/** The pull a black hole of `intensity` has on a body `distance` away: `min(maxAccel, strength · intensity / max(r, minRadius))`. */
export function holeAcceleration(distance: number, intensity: number): number {
  return Math.min(BLACK_HOLE.maxAccel, (BLACK_HOLE.strength * intensity) / Math.max(distance, BLACK_HOLE.minRadius));
}

/**
 * The share of a body's offset to a hole of `intensity`, `distance` away, that is its velocity change over `dt` (or, for
 * the default 1, its acceleration); 0 at the centre itself. Multiply it by the offset (toward the hole) to get the change.
 */
export function holeShare(distance: number, intensity: number, dt = 1): number {
  return distance === 0 ? 0 : (holeAcceleration(distance, intensity) * dt) / distance;
}

/** A hair past a ring's radius, so a spot placed on it is not judged inside it by rounding. */
const RING_SLACK = 1;

/**
 * The spots `distance` from `centre` on the respawn band's bottom row and then its top row, right of it then left, each
 * kept inside the band.
 */
function ringSpots(centre: Readonly<Point>, field: Field, distance: number): Point[] {
  const { left, right, top, bottom } = respawnBand(field);
  return [bottom, top].flatMap((y) => {
    const dx = Math.sqrt(Math.max(0, (distance + RING_SLACK) ** 2 - (y - centre.y) ** 2));
    return [1, -1].map((side) => ({ x: Math.min(right, Math.max(left, centre.x + side * dx)), y }));
  });
}

interface Hole extends PointHazardState {
  stage: HazardState['stage'];
  x: number;
  y: number;
  remaining: number;
}

/**
 * Singularity's black hole: one at the field's centre, warned for its telegraph, then active for its length. Active it pulls
 * the ship (through `shipPullAt`), the rocks and the pulled foes; its horizon swallows the rocks, foes, bolts and player
 * shots that reach it for no points and no drop; touching it costs the ship a life; and a respawning ship comes back at
 * its respawn point from its warning on. It draws from no stream: its place is the field's centre.
 */
export class BlackHole implements Hazard {
  private readonly nextId: () => number;
  private readonly inPlay: () => readonly Readonly<HazardState>[];
  private readonly schedule: HazardSchedule<Hole>;
  /** The field as of the last step or resize; null before the first. */
  private field: Field | null = null;

  constructor({ events, nextId, inPlay }: HazardSetup) {
    this.nextId = nextId;
    this.inPlay = inPlay;
    this.schedule = new HazardSchedule<Hole>(events, HAZARD_RULES.blackHole.telegraph, {
      warn: (event, elapsed, field, into, out) => {
        const id = this.nextId();
        const x = field.width / 2;
        const y = field.height / 2;
        out.push({ type: 'holeWarning', id, x, y, at: event.at });
        into.push({ id, type: 'blackHole', stage: 'warning', x, y, intensity: event.intensity, remaining: event.at - elapsed });
      },
      started: (hole, out) => {
        out.push({ type: 'holeStart', id: hole.id, x: hole.x, y: hole.y });
      },
      ended: (hole, out) => {
        out.push({ type: 'holeEnd', id: hole.id });
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

  /** The hole's pull on the rocks and the foes it pulls, by `dt` seconds of it; the ship's is `shipPullAt`'s. */
  pull(dt: number, { rocks, foes }: Pick<Bodies, 'rocks' | 'foes'>): void {
    const hole = this.active();
    if (hole === null) return;
    for (const rock of rocks) this.pullBody(hole, rock, dt);
    for (const foe of foes) if (FOES[foe.kind].pulled) this.pullBody(hole, foe, dt);
  }

  /** Swallows the rocks, foes and bolts the horizon reaches, for no points and no drop. */
  carry(bodies: Bodies, out: SimEvent[]): void {
    const hole = this.active();
    if (hole === null) return;
    const { rocks } = bodies;
    let kept = 0;
    for (const rock of rocks) {
      if (this.touches(hole, rock.x, rock.y, rock.radius)) out.push({ type: 'asteroidLeft', id: rock.id });
      else rocks[kept++] = rock;
    }
    rocks.length = kept;
    for (const foe of bodies.foes) {
      if (foe.hp > 0 && this.touches(hole, foe.x, foe.y, foe.radius)) {
        foe.hp = 0;
        out.push({ type: 'foeDestroyed', id: foe.id, kind: foe.kind, x: foe.x, y: foe.y, points: 0 });
      }
    }
    bodies.bolts?.clearWithin(hole.x, hole.y, BLACK_HOLE.horizon);
  }

  /** True when a ship (or shot) of radius `r` at (x, y) touches the horizon of an active hole. */
  strikes(x: number, y: number, r: number): boolean {
    const hole = this.active();
    return hole !== null && this.touches(hole, x, y, r);
  }

  /** True when a player shot of radius `r` at (x, y) has reached the horizon of an active hole, and is swallowed. */
  swallows(x: number, y: number, r: number): boolean {
    return this.strikes(x, y, r);
  }

  /**
   * While the hole is warning or active, where a respawning ship comes back: a ship's safe radius outside the hole's
   * `exitReach`, and as far from every live foe, live danger zone and rift mouth, so it neither falls in during its
   * invulnerability nor wakes among a swarm that gathered where it died, in a zone or at a mouth; else null. It tries the
   * spots that far from the hole low in the respawn band, then high, right then left, so a respawn lies as far from the
   * hole on every field; the respawn search (`clearSpot`) takes over when those are crowded.
   */
  respawnPoint(foes: readonly Readonly<Foe>[]): Readonly<Point> | null {
    const hole = this.schedule.live[0];
    if (this.field === null || hole === undefined) return null;
    const parts: RespawnPart[] = [...foes];
    const zones: ZoneBox[] = [];
    for (const hazard of this.inPlay()) {
      if (hazard.type === 'dangerZone') zones.push(hazard);
      else if (hazard.type === 'warpRift') parts.push({ x: hazard.x, y: hazard.y, radius: WARP_RIFT.radius }, { x: hazard.toX, y: hazard.toY, radius: WARP_RIFT.radius });
    }
    return clearSpot({ x: hole.x, y: hole.y, parts, zones }, BLACK_HOLE.exitReach, this.field, RESPAWN_MARGIN, this.ring(this.field));
  }

  /** While the hole is warning or active, where its respawn comes back in `field` with nothing in the way, whatever the foes; else null. */
  respawnSpot(field: Field): Readonly<Point> | null {
    return this.ring(field)[0] ?? null;
  }

  resize(old: Field, field: Field): void {
    this.field = field;
    this.centre(field);
  }

  stop(): void {
    this.schedule.stop();
  }

  /** The spots a respawn tries first while the hole is warning or active: a respawn's margin outside its `exitReach`. */
  private ring(field: Field): Point[] {
    const hole = this.schedule.live[0];
    return hole === undefined ? [] : ringSpots(hole, field, BLACK_HOLE.exitReach + RESPAWN_MARGIN);
  }

  /** The active hole, if there is one: the only one a galaxy holds at once. */
  private active(): Hole | null {
    const hole = this.schedule.live[0];
    return hole?.stage === 'active' ? hole : null;
  }

  /** Keeps every hole at the centre of `field`, as a resize leaves it. */
  private centre(field: Field): void {
    for (const hole of this.schedule.live) {
      hole.x = field.width / 2;
      hole.y = field.height / 2;
    }
  }

  /** Whether a body of radius `r` at (x, y) reaches the horizon of `hole`. */
  private touches(hole: Readonly<Hole>, x: number, y: number, r: number): boolean {
    return Math.hypot(x - hole.x, y - hole.y) < BLACK_HOLE.horizon + r;
  }

  /** Speeds `body` toward the hole by its share of the pull, but not past `BLACK_HOLE.rockSpeedCap`. */
  private pullBody(hole: Readonly<Hole>, body: Pullable, dt: number): void {
    const dx = hole.x - body.x;
    const dy = hole.y - body.y;
    const share = holeShare(Math.hypot(dx, dy), hole.intensity, dt);
    if (share !== 0) nudge(body, dx * share, dy * share, BLACK_HOLE.rockSpeedCap);
  }
}
