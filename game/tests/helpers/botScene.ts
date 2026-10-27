import { createView, type BotView } from '../../src/bot/view';
import { BOLT } from '../../src/content/foes';
import { galaxyById } from '../../src/content/galaxies';
import type { AttackId, BossId } from '../../src/content/types';
import type { AttackSpec, BossThreat, Point } from '../../src/sim/boss/behaviour';
import { bossThreat } from '../../src/sim/boss/bossRules';
import { BOSS_BEHAVIOURS } from '../../src/sim/boss/roster';
import type { Bolt } from '../../src/sim/foes/bolts';
import { createRng } from '../../src/sim/rng';
import { World, type AsteroidPlacement } from '../../src/sim/world';
import { bossView } from './bossView';
import { MUTED_KINDS } from './mute';

export const SCENE_FIELD = { width: 1280, height: 720 };
/** Where a scene's ship sits, nose to the right. */
export const SCENE_SHIP = { x: 640, y: 360 };

/** A hostile bolt `id` at (x, y) flying along `angle` at the default speed; `fromAttack` marks it a boss attack's. */
export const flyingBolt = (id: number, x: number, y: number, angle: number, fromAttack = false): Bolt => ({
  id, x, y, px: x, py: y, vx: Math.cos(angle) * BOLT.speed, vy: Math.sin(angle) * BOLT.speed, radius: BOLT.radius, age: 0, source: 'boss', owner: 0, fromAttack,
});

/** A tiny rock at rest at (x, y). */
export const stillRock = (x: number, y: number): AsteroidPlacement => ({ x, y, size: 3, angle: 0, speedMultiplier: 0 });

/**
 * A bot's view of a galaxy whose director spawns nothing: the ship at rest at `SCENE_SHIP`, already vulnerable, and only
 * `rocks` on the field. Its fields can be replaced to stage foes or a boss.
 */
export function sceneView(rocks: readonly AsteroidPlacement[] = []): BotView {
  const galaxy = { ...galaxyById('2-4'), kinds: MUTED_KINDS, events: [] };
  const world = new World({ seed: 1, field: SCENE_FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' }, initialShip: { ...SCENE_SHIP, angle: 0 }, initialAsteroids: rocks });
  const view = createView(world);
  view.ship = { ...view.ship, invulnerable: false, invulnerableFor: 0 };
  return view;
}

/** Every roster boss's attacks, made once against a field with no room for drones. */
const ROSTER_ATTACKS: readonly Readonly<Partial<Record<AttackId, AttackSpec>>>[] = Object.values(BOSS_BEHAVIOURS).map(
  (make) => make({ maxHp: 60, rng: createRng(1), rockSpeed: 1, field: SCENE_FIELD, foes: { launch: () => false, launched: 0 } }).attacks,
);

/** `attack`'s threat as a boss of core `radius` shows it, from whichever roster boss declares the attack. */
export function threatOf(attack: AttackId, radius = 90): BossThreat {
  const spec = ROSTER_ATTACKS.map((attacks) => attacks[attack]).find((found) => found !== undefined);
  if (spec === undefined) throw new Error(`no roster boss makes attack ${attack}: stage one that does`);
  return bossThreat(attack, spec, radius);
}

export interface Staged {
  readonly id?: BossId;
  readonly at?: Point;
  readonly radius?: number;
  readonly target?: Point | null;
  readonly windup?: AttackId | null;
  /** The threat it shows, if not the one its roster boss declares for `windup`. */
  readonly threat?: BossThreat;
}

/**
 * Puts a boss in the fight into `view`, standing still: its weak point at its core unless `target` says otherwise, and
 * winding up `windup`, with the threat its roster boss declares, if given, aimed where the ship is.
 */
export function stage(view: BotView, { id = 'monolith', at = { x: 640, y: 130 }, radius = 90, target = at, windup = null, threat: shown }: Staged): BotView {
  const threat = shown ?? (windup === null ? null : threatOf(windup, radius));
  view.boss = bossView({ id, ...at, radius, hp: 60, maxHp: 60, phase: 3, windup, vulnerable: target !== null, target, threat, aim: { x: view.ship.x, y: view.ship.y } });
  return view;
}
