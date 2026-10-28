import { galaxyById } from '../../src/content/galaxies';
import type { AsteroidSize } from '../../src/sim/asteroid';
import type { GalaxyDef, GalaxyId, KindRamp, ThreatKind } from '../../src/content/types';
import type { AsteroidPlacement } from '../../src/sim/worldOptions';

/** A ramp that never picks its kind. */
export const MUTE: KindRamp = { from: 0, base: 0, step: 0, max: 0 };

/** Ramps under which the director spawns nothing, so only a scenario's own threats exist. */
export const MUTED_KINDS: Readonly<Record<ThreatKind, KindRamp>> = { large: MUTE, medium: MUTE, small: MUTE, splitter: MUTE, drone: MUTE, gunship: MUTE, mine: MUTE, phaser: MUTE, armoured: MUTE };

/** Galaxy `id` with a director that never spawns and no scheduled events, so only a scenario's own threats exist. */
export const calmGalaxy = (id: GalaxyId): GalaxyDef => ({ ...galaxyById(id), kinds: MUTED_KINDS, events: [] });

/** A motionless rock of `size` at (x, y), for a scenario's `initialAsteroids`: it stays where the test put it. */
export const still = (x: number, y: number, size: AsteroidSize): AsteroidPlacement => ({ x, y, size, angle: 0, speedMultiplier: 0 });
