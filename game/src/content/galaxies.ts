import { showerSeconds } from './curves';
import { BOSS_APPROACH_SECONDS, lullStart } from './pacingRules';
import { newIn, poolFor } from './pickups';
import { galaxyIdOf, type BossId, type Dimension, type GalaxyDef, type GalaxyEvent, type GalaxyId, type GalaxyIndex, type KindRamp, type MusicThemeId, type PaletteId, type ThreatKind } from './types';

export const DIMENSIONS: Readonly<Record<Dimension, string>> = {
  1: 'The Drift',
  2: 'Ion Reach',
  3: 'Crimson Nebula',
  4: 'Void Rift',
  5: 'Singularity',
};

/** How each Dimension looks and sounds. */
const LOOKS: Readonly<Record<Dimension, { readonly palette: PaletteId; readonly theme: MusicThemeId }>> = {
  1: { palette: 'drift', theme: 'drift' },
  2: { palette: 'ionReach', theme: 'ionReach' },
  3: { palette: 'crimsonNebula', theme: 'crimsonNebula' },
  4: { palette: 'voidRift', theme: 'voidRift' },
  5: { palette: 'singularity', theme: 'singularity' },
};

type Ramps = Readonly<Record<ThreatKind, KindRamp>>;

const ABSENT: KindRamp = { from: 0, base: 0, step: 0, max: 0 };

/** Tuned against the bots' difficulty targets (tests/balance). Every galaxy shares one of the four tables below. */
const ROCKS: Ramps = {
  large: { from: 0, base: 0.6, step: 0, max: 0.6 },
  medium: { from: 0, base: 0.3, step: 0.05, max: 0.5 },
  small: { from: 0.5, base: 0.1, step: 0.05, max: 0.4 },
  splitter: ABSENT,
  drone: ABSENT,
  gunship: ABSENT,
  mine: ABSENT,
  phaser: ABSENT,
  armoured: ABSENT,
};
const SPLITTERS: Ramps = { ...ROCKS, splitter: { from: 0.4, base: 0.15, step: 0.08, max: 0.35 } };
/** Ion Reach trades some of the large rocks, and their fragments, for drones that come more often galaxy by galaxy. */
const SWARMS: Ramps = { ...SPLITTERS, large: { from: 0, base: 0.45, step: 0, max: 0.45 }, drone: { from: 1, base: 0.15, step: 0.3, max: 0.45 } };
/**
 * Crimson Nebula keeps Ion Reach's table, and brings in gunships from its first galaxy and mines from its second, both
 * climbing gently, so the Dimension's later galaxies are not much more crowded with foes than its first.
 */
const GUNSHIPS: Ramps = { ...SWARMS, gunship: { from: 2, base: 0.1, step: 0.1, max: 0.2 }, mine: { from: 2, base: 0, step: 0.15, max: 0.12 } };
/**
 * Void Rift keeps Crimson Nebula's foes at the maxima they reach there, and brings in phasers and armoured rocks from its
 * first galaxy, each at its base there and climbing slowly from it.
 */
const VOID: Ramps = {
  ...GUNSHIPS,
  gunship: { from: 2, base: 0.1, step: 0.2, max: 0.2 },
  mine: { from: 2, base: 0, step: 0.3, max: 0.12 },
  phaser: { from: 3, base: 0.12, step: 0.05, max: 0.3 },
  armoured: { from: 3, base: 0.1, step: 0.05, max: 0.28 },
};
/**
 * Singularity brings every foe into the mix, each at a maximum of about a fifth to a quarter of the budget, the rocks
 * and the foes it has in common with Void Rift kept as they are. The director's budget, not these maxima, sets how
 * crowded the field gets.
 */
const SINGULARITY: Ramps = {
  ...VOID,
  splitter: { from: 0.4, base: 0.15, step: 0.08, max: 0.25 },
  drone: { from: 1, base: 0.15, step: 0.3, max: 0.25 },
  gunship: { from: 2, base: 0.1, step: 0.2, max: 0.25 },
  mine: { from: 2, base: 0, step: 0.3, max: 0.2 },
  phaser: { from: 3, base: 0.12, step: 0.1, max: 0.25 },
  armoured: { from: 3, base: 0.1, step: 0.1, max: 0.25 },
};
/** A boss galaxy brings no large rocks and no foes but the boss's own, so its fight is not fought among fragments. */
const BOSS_FIELD: Ramps = { ...ROCKS, large: ABSENT };

/**
 * Splitters join from 1-3, drones from Ion Reach, which keeps the splitters, gunships and mines from Crimson Nebula,
 * which keeps the rest, and phasers and armoured rocks from Void Rift, which Singularity keeps and mixes every foe into; a
 * boss galaxy has none.
 */
function rampsFor(dimension: Dimension, index: GalaxyIndex): Ramps {
  if (index === 6) return BOSS_FIELD;
  if (dimension === 1) return index >= 3 ? SPLITTERS : ROCKS;
  if (dimension === 2) return SWARMS;
  if (dimension === 3) return GUNSHIPS;
  if (dimension === 4) return VOID;
  return SINGULARITY;
}

/** Each Dimension's boss. */
const BOSS_OF: Readonly<Record<Dimension, BossId>> = { 1: 'monolith', 2: 'hiveCarrier', 3: 'warden', 4: 'leviathan', 5: 'eclipse' };

/** When, as a share of the duration, a galaxy's showers fall: one, or two with the second at 60%. */
const SHOWER_SHARES: Readonly<Record<1 | 2, readonly number[]>> = { 1: [0.45], 2: [0.3, 0.6] };

/** The first Dimension whose opening galaxy features its new pickups. */
const FIRST_FEATURING: Dimension = 3;

const survivalSeconds = (dimension: Dimension): number => 90 + 15 * (dimension - 1);

/** Showers fall at their share of the duration, but late enough ones move earlier so they end by the lull. */
function showers(dimension: Dimension, index: GalaxyIndex, duration: number): GalaxyEvent[] {
  if (dimension === 1 && index <= 3) return [];
  if (dimension === 1 && index === 4) return [{ at: 50, type: 'meteorShower', intensity: 1 }];
  const intensity = Math.min(3, dimension) as GalaxyEvent['intensity'];
  const latest = lullStart({ duration }) - showerSeconds(intensity);
  return SHOWER_SHARES[index <= 3 ? 1 : 2].map((share) => ({ at: Math.min(latest, Math.round(duration * share)), type: 'meteorShower', intensity }));
}

/** Events of `type`, made by when they start and how hard. */
const eventsOf = (type: GalaxyEvent['type']) => (at: number, intensity: GalaxyEvent['intensity']): GalaxyEvent => ({ at, type, intensity });
const well = eventsOf('gravityWell');
const zone = eventsOf('dangerZone');
const repulsion = eventsOf('repulsionField');
const rift = eventsOf('warpRift');
const hole = eventsOf('blackHole');

/**
 * Each Dimension's hazards by galaxy index: Ion Reach's gravity wells, Crimson Nebula's danger zones, Void Rift's
 * repulsion fields and warp rifts, and Singularity's black hole with the rest. Each ends before the lull.
 */
const HAZARDS: Readonly<Partial<Record<Dimension, Readonly<Partial<Record<GalaxyIndex, readonly GalaxyEvent[]>>>>>> = {
  2: { 2: [well(25, 1)], 3: [well(25, 1)], 4: [well(46, 1)], 5: [well(46, 1)] },
  3: { 2: [zone(30, 1)], 3: [zone(30, 1), zone(70, 1)], 4: [zone(20, 1), zone(50, 2)], 5: [zone(20, 2), zone(50, 2)] },
  4: { 2: [repulsion(25, 1)], 3: [rift(20, 1), repulsion(80, 1)], 4: [rift(20, 1), repulsion(56, 2)], 5: [rift(15, 2), repulsion(56, 2)] },
  // Singularity's black hole opens at 12 s on every survival galaxy, warned from 9 s, and ends at 87, before the lull. Each
  // other event starts 10 s or more after the one before it, and no more than two run at once, showers included: 5-4's
  // repulsion field moves from 30 to 25 so it ends before the shower at 45 warns (from 42), and its zone from 95 to 100,
  // 10 s after the shower at 90. 5-5's rift moves from 20 to 22 for the same 10 s.
  5: { 1: [hole(12, 1)], 2: [hole(12, 1), zone(30, 1)], 3: [hole(12, 2), rift(25, 1), zone(100, 1)], 4: [hole(12, 2), repulsion(25, 1), zone(100, 1)], 5: [hole(12, 3), rift(22, 1), zone(60, 1)] },
};

const hazards = (dimension: Dimension, index: GalaxyIndex): readonly GalaxyEvent[] => HAZARDS[dimension]?.[index] ?? [];

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
    events: boss ? [] : [...showers(dimension, index, duration), ...hazards(dimension, index)].sort((a, b) => a.at - b.at),
    pickups: poolFor(dimension),
    // A Dimension's breather (its first galaxy) features the pickups new to it; D1 and D2 bring theirs in without one.
    featured: index === 1 && dimension >= FIRST_FEATURING ? newIn(dimension) : [],
    boss: boss ? BOSS_OF[dimension] : null,
    ...LOOKS[dimension],
  };
}

export const DIMENSION_NUMBERS: readonly Dimension[] = [1, 2, 3, 4, 5];
export const GALAXY_INDEXES: readonly GalaxyIndex[] = [1, 2, 3, 4, 5, 6];
/** Stars a Dimension holds: three for each of its galaxies. */
export const STARS_PER_DIMENSION = 3 * GALAXY_INDEXES.length;
/** Stars across every Dimension. */
export const ALL_STARS = STARS_PER_DIMENSION * DIMENSION_NUMBERS.length;

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
