import { showerSeconds } from './curves';
import { BOSS_APPROACH_SECONDS, lullStart } from './pacingRules';
import type { BossId, Dimension, GalaxyDef, GalaxyEvent, GalaxyId, GalaxyIndex, KindRamp, RockKind } from './types';

export const DIMENSIONS: Readonly<Record<Dimension, string>> = {
  1: 'The Drift',
  2: 'Ion Reach',
  3: 'Crimson Nebula',
  4: 'Void Rift',
  5: 'Singularity',
};

/** Initial values; M5 balance tunes them. Every galaxy shares this one table. */
const KIND_RAMPS: Readonly<Record<RockKind, KindRamp>> = {
  large: { from: 0, base: 0.6, step: 0, max: 0.6 },
  medium: { from: 0, base: 0.3, step: 0.05, max: 0.5 },
  small: { from: 0.5, base: 0.1, step: 0.05, max: 0.4 },
};

/** M5 replaces this per Dimension. */
const PLACEHOLDER_BOSS: BossId = 'sentinel';

/** When, as a share of the duration, a galaxy's showers fall: one, or two with the second at 60%. */
const SHOWER_SHARES: Readonly<Record<1 | 2, readonly number[]>> = { 1: [0.45], 2: [0.3, 0.6] };

const survivalSeconds = (dimension: Dimension): number => 90 + 15 * (dimension - 1);

/** Showers fall at their share of the duration, but late enough ones move earlier so they end by the lull. */
function showers(dimension: Dimension, index: GalaxyIndex, duration: number): GalaxyEvent[] {
  if (dimension === 1 && index <= 3) return [];
  if (dimension === 1 && index === 4) return [{ at: 50, type: 'meteorShower', intensity: 1 }];
  const intensity = Math.min(3, dimension) as GalaxyEvent['intensity'];
  const latest = lullStart({ duration }) - showerSeconds(intensity);
  return SHOWER_SHARES[index <= 3 ? 1 : 2].map((share) => ({ at: Math.min(latest, Math.round(duration * share)), type: 'meteorShower', intensity }));
}

function galaxy(dimension: Dimension, index: GalaxyIndex): GalaxyDef {
  const boss = index === 6;
  const duration = boss ? BOSS_APPROACH_SECONDS : survivalSeconds(dimension);
  return {
    id: `${String(dimension)}-${String(index)}` as GalaxyId,
    dimension,
    index,
    kind: boss ? 'boss' : 'survival',
    duration,
    kinds: KIND_RAMPS,
    events: boss ? [] : showers(dimension, index, duration),
    pickups: [],
    boss: boss ? PLACEHOLDER_BOSS : null,
    palette: 'drift',
  };
}

const DIMENSION_NUMBERS: readonly Dimension[] = [1, 2, 3, 4, 5];
const GALAXY_INDEXES: readonly GalaxyIndex[] = [1, 2, 3, 4, 5, 6];

export const GALAXIES: readonly GalaxyDef[] = DIMENSION_NUMBERS.flatMap((dimension) => GALAXY_INDEXES.map((index) => galaxy(dimension, index)));

const BY_ID: ReadonlyMap<GalaxyId, GalaxyDef> = new Map(GALAXIES.map((g) => [g.id, g]));

export function galaxyById(id: GalaxyId): GalaxyDef {
  const found = BY_ID.get(id);
  if (found === undefined) throw new RangeError(`No galaxy "${id}": ids run from 1-1 to 5-6`);
  return found;
}

const ORDER: ReadonlyMap<GalaxyId, number> = new Map(GALAXIES.map((g, i) => [g.id, i]));

export function isGalaxyId(value: unknown): value is GalaxyId {
  return ORDER.has(value as GalaxyId);
}

/** Where a galaxy falls in the linear run from 1-1 (0) to 5-6 (29). */
export function galaxyOrdinal(id: GalaxyId): number {
  const found = ORDER.get(id);
  if (found === undefined) throw new RangeError(`No galaxy "${id}": ids run from 1-1 to 5-6`);
  return found;
}

/** The further of two galaxies in the run. */
export function furthest(a: GalaxyId, b: GalaxyId): GalaxyId {
  return galaxyOrdinal(b) > galaxyOrdinal(a) ? b : a;
}

/** The galaxy after `id` in the linear run; null after 5-6. */
export function nextGalaxyId(id: GalaxyId): GalaxyId | null {
  return GALAXIES[galaxyOrdinal(id) + 1]?.id ?? null;
}

/** `'2-★'` for a Dimension's boss galaxy, else the id. */
export function galaxyLabel(id: GalaxyId): string {
  return id.endsWith('-6') ? `${id.slice(0, 1)}-★` : id;
}

/** The difficulty tier the curves take: `(d - 1) + (g - 1) / 5`. */
export function tierOf(g: Pick<GalaxyDef, 'dimension' | 'index'>): number {
  return g.dimension - 1 + (g.index - 1) / 5;
}
