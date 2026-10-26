import type { GalaxyDef } from '../../content/types';

export type Phase = 'opening' | 'build' | 'lull' | 'surge' | 'warp' | 'boss';

const OPENING_SECONDS = 15;
const LULL_SECONDS = 10;
const SURGE_SECONDS = 20;
const BUILD_FROM = 0.6;
const BUILD_TO = 1;

const FIXED_SCALE: Readonly<Record<Exclude<Phase, 'build'>, number>> = {
  opening: 0.5,
  lull: 0.3,
  surge: 1.2,
  warp: 0,
  boss: 0.25,
};

/** When the lull starts: it ends as the surge begins, 20 s before the duration. */
const lullStart = (galaxy: GalaxyDef): number => galaxy.duration - SURGE_SECONDS - LULL_SECONDS;

/** A boss galaxy is all opening for its approach, then `boss`; a survival galaxy runs opening, build, lull, surge, warp. */
export function phaseAt(galaxy: GalaxyDef, elapsed: number): Phase {
  if (galaxy.kind === 'boss') return elapsed < galaxy.duration ? 'opening' : 'boss';
  if (elapsed >= galaxy.duration) return 'warp';
  if (elapsed < OPENING_SECONDS) return 'opening';
  if (elapsed < lullStart(galaxy)) return 'build';
  return elapsed < galaxy.duration - SURGE_SECONDS ? 'lull' : 'surge';
}

/** How hard the field is pressed at `elapsed` seconds in: the build climbs linearly from 0.6 to 1 across its span. */
export function pressureScale(galaxy: GalaxyDef, elapsed: number): number {
  return phasePressure(galaxy, phaseAt(galaxy, elapsed), elapsed);
}

/** `pressureScale` for a caller that already knows the phase at `elapsed`. */
export function phasePressure(galaxy: GalaxyDef, phase: Phase, elapsed: number): number {
  if (phase !== 'build') return FIXED_SCALE[phase];
  const progress = (elapsed - OPENING_SECONDS) / (lullStart(galaxy) - OPENING_SECONDS);
  return BUILD_FROM + (BUILD_TO - BUILD_FROM) * progress;
}
