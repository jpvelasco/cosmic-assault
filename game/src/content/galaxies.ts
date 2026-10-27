import { showerSeconds } from './curves';
import { BOSS_APPROACH_SECONDS, lullStart } from './pacingRules';
import { poolFor } from './pickups';
import type { BossId, Dimension, GalaxyDef, GalaxyEvent, GalaxyId, GalaxyIndex, KindRamp, MusicThemeId, PaletteId, ThreatKind } from './types';

export const DIMENSIONS: Readonly<Record<Dimension, string>> = {
  1: 'The Drift',
  2: 'Ion Reach',
  3: 'Crimson Nebula',
  4: 'Void Rift',
  5: 'Singularity',
};

/** How each Dimension looks and sounds. The Dimensions after Ion Reach keep the Drift's until M6 gives them their own. */
const LOOKS: Readonly<Record<Dimension, { readonly palette: PaletteId; readonly theme: MusicThemeId }>> = {
  1: { palette: 'drift', theme: 'drift' },
  2: { palette: 'ionReach', theme: 'ionReach' },
  3: { palette: 'drift', theme: 'drift' },
  4: { palette: 'drift', theme: 'drift' },
  5: { palette: 'drift', theme: 'drift' },
};

type Ramps = Readonly<Record<ThreatKind, KindRamp>>;

const ABSENT: KindRamp = { from: 0, base: 0, step: 0, max: 0 };

/** Initial values; M5 balance tunes them. Every galaxy shares one of the three tables below. */
const ROCKS: Ramps = {
  large: { from: 0, base: 0.6, step: 0, max: 0.6 },
  medium: { from: 0, base: 0.3, step: 0.05, max: 0.5 },
  small: { from: 0.5, base: 0.1, step: 0.05, max: 0.4 },
  splitter: ABSENT,
  drone: ABSENT,
};
const SPLITTERS: Ramps = { ...ROCKS, splitter: { from: 0.4, base: 0.15, step: 0.08, max: 0.35 } };
const SWARMS: Ramps = { ...SPLITTERS, drone: { from: 1, base: 0.2, step: 0.08, max: 0.45 } };

/**
 * Splitters join from 1-3 and drones from Ion Reach, which keeps the splitters. The Dimensions after it keep their
 * rocks until their own foes are made (M6).
 */
function rampsFor(dimension: Dimension, index: GalaxyIndex): Ramps {
  if (dimension === 1) return index >= 3 ? SPLITTERS : ROCKS;
  return dimension === 2 ? SWARMS : ROCKS;
}

/** Each Dimension's boss; the M4 Sentinel holds the later ones until they get their own. */
const BOSS_OF: Readonly<Record<Dimension, BossId>> = { 1: 'monolith', 2: 'hiveCarrier', 3: 'sentinel', 4: 'sentinel', 5: 'sentinel' };

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

/** Ion Reach's gravity wells by galaxy index: when one starts, and how hard it pulls. Each ends before the lull. */
const WELLS: Readonly<Partial<Record<GalaxyIndex, readonly [at: number, intensity: GalaxyEvent['intensity']]>>> = {
  2: [25, 1],
  3: [28, 1],
  4: [46, 2],
  5: [46, 2],
};

function wells(dimension: Dimension, index: GalaxyIndex): GalaxyEvent[] {
  const well = dimension === 2 ? WELLS[index] : undefined;
  return well === undefined ? [] : [{ at: well[0], type: 'gravityWell', intensity: well[1] }];
}

/** The id of galaxy `index` of Dimension `dimension`: `galaxyIdOf(3, 4)` is `'3-4'`. */
export function galaxyIdOf(dimension: Dimension, index: GalaxyIndex): GalaxyId {
  return `${String(dimension)}-${String(index)}` as GalaxyId;
}

function galaxy(dimension: Dimension, index: GalaxyIndex): GalaxyDef {
  const boss = index === 6;
  const duration = boss ? BOSS_APPROACH_SECONDS : survivalSeconds(dimension);
  return {
    id: galaxyIdOf(dimension, index),
    dimension,
    index,
    kind: boss ? 'boss' : 'survival',
    duration,
    kinds: rampsFor(dimension, index),
    events: boss ? [] : [...showers(dimension, index, duration), ...wells(dimension, index)].sort((a, b) => a.at - b.at),
    pickups: poolFor(dimension),
    boss: boss ? BOSS_OF[dimension] : null,
    ...LOOKS[dimension],
  };
}

export const DIMENSION_NUMBERS: readonly Dimension[] = [1, 2, 3, 4, 5];
export const GALAXY_INDEXES: readonly GalaxyIndex[] = [1, 2, 3, 4, 5, 6];

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
