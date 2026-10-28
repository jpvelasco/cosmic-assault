import type { BossDef } from '../../content/bosses';
import { MIN_WINDUP_SECONDS } from '../../content/pacingRules';
import type { AttackId } from '../../content/types';
import type { Field } from '../field';
import type { AttackSpec, BossBehaviour, BossPart, BossPhase, BossThreat, BossView, Point } from './behaviour';

// The rules every boss fight keeps, apart from the runner that steps one: where a boss arrives, where a ship respawns
// clear of it, where a shot does harm, how its HP sets its phase, and what its definition and behaviour must hold.

/** Where a boss arrives, as a share of the field height from the top. */
const HOME_HEIGHT_SHARE = 0.28;
/** The most speed a boss's shove leaves the ship with, in units per second; a ship already faster only keeps from gaining. */
export const MAX_SHOVE_SPEED = 300;

/** How far inside the field's edges a ship respawns clear of a boss. */
export const RESPAWN_INSET = 60;
/**
 * The lowest a ship respawns in a boss galaxy, as a share of the field height: above the band the HUD's boss bar sits
 * in along the bottom (render/hud.ts), on every screen.
 */
export const RESPAWN_LOWEST_SHARE = 0.8;

/**
 * A body a respawn keeps clear of, as its reach is measured: a boss's core and the parts it may have, or a black hole and
 * the foes round it. Only the live parts count.
 */
export type BossBodies = Readonly<Point> & { readonly parts?: readonly Readonly<Pick<BossPart, 'x' | 'y' | 'radius' | 'hp'>>[] };

/**
 * How far (x, y) lies outside the boss: outside the circle of `reach` about its core, and outside every live part by
 * that part's own radius, whichever is nearer. Negative inside either. A part that trails far beyond the core's reach,
 * a serpent's tail say, counts as much as the core.
 */
export function bossClearance(boss: BossBodies, reach: number, x: number, y: number): number {
  let clearance = Math.hypot(x - boss.x, y - boss.y) - reach;
  for (const part of boss.parts ?? []) if (part.hp > 0) clearance = Math.min(clearance, Math.hypot(x - part.x, y - part.y) - part.radius);
  return clearance;
}

/** The grid a respawn searches when none of its five usual spots is clear: columns and rows across the respawn band. */
const RESPAWN_GRID_COLUMNS = 9;
const RESPAWN_GRID_ROWS = 6;

/**
 * Where a ship can respawn at least `margin` outside the boss (`bossClearance`): low in the middle, at
 * `RESPAWN_LOWEST_SHARE` of the height; or, if the boss lies too near it, the corner farthest from the core, as low or as
 * near the top; or, if a part lies on that too, the first other corner that is clear. If none of those is, the first
 * clear point of a grid across the same band, row by row from the bottom, as low as the usual spots prefer; else, with
 * nowhere clear, the clearest spot of all, the first found among equals, so a respawn is always the same for the same
 * boss.
 */
export function clearSpot(boss: BossBodies, reach: number, field: Field, margin = 0): Point {
  const [left, right, top, bottom] = [RESPAWN_INSET, field.width - RESPAWN_INSET, RESPAWN_INSET, field.height * RESPAWN_LOWEST_SHARE];
  const farX = Math.abs(boss.x - left) > Math.abs(boss.x - right) ? left : right;
  const farY = Math.abs(boss.y - top) > Math.abs(boss.y - bottom) ? top : bottom;
  const spots: readonly Point[] = [{ x: field.width / 2, y: bottom }, { x: farX, y: farY }, { x: left + right - farX, y: farY }, { x: farX, y: top + bottom - farY }, { x: left + right - farX, y: top + bottom - farY }];
  let best = spots[1] as Point;
  let bestClearance = -Infinity;
  /** Whether `spot` is clear by `margin`, noting it if it is the clearest yet. */
  const clear = (spot: Point): boolean => {
    const clearance = bossClearance(boss, reach, spot.x, spot.y);
    if (clearance > bestClearance) [best, bestClearance] = [spot, clearance];
    return clearance >= margin;
  };
  for (const spot of spots) if (clear(spot)) return spot;
  for (let row = RESPAWN_GRID_ROWS - 1; row >= 0; row--) {
    for (let column = 0; column < RESPAWN_GRID_COLUMNS; column++) {
      const spot = { x: left + ((right - left) * column) / (RESPAWN_GRID_COLUMNS - 1), y: top + ((bottom - top) * row) / (RESPAWN_GRID_ROWS - 1) };
      if (clear(spot)) return spot;
    }
  }
  return best;
}

/** Where a boss arrives in `field`. */
export function bossHome(field: Field): Readonly<Point> {
  return { x: field.width / 2, y: field.height * HOME_HEIGHT_SHARE };
}

export function phaseFor(hp: number, maxHp: number): BossPhase {
  if (hp * 3 <= maxHp) return 3;
  return hp * 3 <= maxHp * 2 ? 2 : 1;
}

/** Where a shot does harm now: wherever the boss's behaviour says, by default the core if it can be hurt, else a live part; nowhere outside the fight. */
export function bossTarget(view: Readonly<BossView>): Readonly<Point> | null {
  return view.state === 'fighting' ? view.target : null;
}

/** Where a shot harms a boss whose behaviour does not say: the core if it can be hurt, else its first live part that is not armoured. */
export function coreOrPart(view: Readonly<BossView>): Readonly<Point> | null {
  if (view.vulnerable) return view;
  for (const part of view.parts) if (part.hp > 0 && part.armoured !== true) return part;
  return null;
}

export function assertAttacks(def: BossDef, behaviour: BossBehaviour): void {
  def.phases.forEach((list, i) => {
    for (const id of list) {
      if (behaviour.attacks[id] === undefined) throw new RangeError(`${def.id}'s phase ${String(i + 1)} names attack ${id}, which its behaviour lacks: add ${id} to the behaviour's attacks, or drop it from the phase`);
    }
  });
  for (const [id, spec] of Object.entries(behaviour.attacks)) {
    if (!(spec.windup >= MIN_WINDUP_SECONDS)) {
      throw new RangeError(`attack ${id} has a windup of ${String(spec.windup)} s, under the ${String(MIN_WINDUP_SECONDS)} s minimum: give it a telegraph of at least ${String(MIN_WINDUP_SECONDS)} s`);
    }
  }
}

/** `attack`'s threat as the bots read it, resolved for a boss whose core has `radius`. */
export function bossThreat(attack: AttackId, spec: Readonly<AttackSpec>, radius: number): BossThreat {
  const { windup, threat } = spec;
  if (threat === undefined) return { attack, windup, kind: 'none', reach: 0, speed: 0 };
  if (threat.kind === 'shove') return { attack, windup, kind: 'shove', reach: threat.reach, speed: threat.speed };
  if (threat.kind === 'ring') return { attack, windup, kind: 'ring', reach: threat.reach, speed: 0, ring: { radius: threat.radius, around: threat.around } };
  return { attack, windup, kind: 'lane', reach: threat.reach === 'core' ? radius : threat.reach, speed: 0 };
}

export function assertDamage(damage: number): void {
  if (!(damage > 0 && Number.isFinite(damage))) {
    throw new RangeError(`boss damage must be a positive finite damage (got ${String(damage)}): pass 1 for a shot`);
  }
}
