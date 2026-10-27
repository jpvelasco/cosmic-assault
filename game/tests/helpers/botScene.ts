import { createView, type BotView } from '../../src/bot/view';
import { galaxyById } from '../../src/content/galaxies';
import { World, type AsteroidPlacement } from '../../src/sim/world';
import { MUTED_KINDS } from './mute';

export const SCENE_FIELD = { width: 1280, height: 720 };
/** Where a scene's ship sits, nose to the right. */
export const SCENE_SHIP = { x: 640, y: 360 };

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
