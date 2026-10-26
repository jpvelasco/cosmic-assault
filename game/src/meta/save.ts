import { galaxyOrdinal, GALAXIES, isGalaxyId } from '../content/galaxies';
import type { GalaxyId } from '../content/types';
import { addEntry, type RankEntry } from './rankBoard';
import { RANK_MAX_LIVES, type RankRun } from './rankRun';

export const SAVE_KEY = 'cosmic-assault.v2';

export interface GalaxyProgress {
  readonly bestScore: number;
  readonly stars: 0 | 1 | 2 | 3;
}

export interface SaveData {
  readonly version: 1;
  /** The furthest galaxy unlocked. */
  readonly frontier: GalaxyId;
  readonly galaxies: Readonly<Partial<Record<GalaxyId, GalaxyProgress>>>;
  readonly rankRun: RankRun | null;
  readonly rankBoard: readonly RankEntry[];
  /** The classic game's high score, imported once; null when there was none. */
  readonly classicBest: number | null;
  readonly classicImported: boolean;
}

export function defaultSave(): SaveData {
  return { version: 1, frontier: '1-1', galaxies: {}, rankRun: null, rankBoard: [], classicBest: null, classicImported: false };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REACHED = /^D[1-5] · (?:G[1-5]|★)$/;
const WEAPON_TIERS: readonly RankRun['weaponTier'][] = [0, 1, 2, 3];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value);
}

function sanitizeStars(value: unknown): GalaxyProgress['stars'] {
  return typeof value === 'number' && !Number.isNaN(value) ? (Math.min(3, Math.max(0, Math.floor(value))) as GalaxyProgress['stars']) : 0;
}

function sanitizeGalaxies(raw: unknown): SaveData['galaxies'] {
  const out: Partial<Record<GalaxyId, GalaxyProgress>> = {};
  for (const [id, value] of Object.entries(asRecord(raw) ?? {})) {
    const record = asRecord(value);
    if (isGalaxyId(id) && record !== null) out[id] = { bestScore: isCount(record['bestScore']) ? record['bestScore'] : 0, stars: sanitizeStars(record['stars']) };
  }
  return out;
}

function sanitizeRankRun(raw: unknown): RankRun | null {
  const run = asRecord(raw);
  if (run === null) return null;
  const { next, score, lives, weaponTier, continued, startedAt } = run;
  const tier = WEAPON_TIERS.find((t) => t === weaponTier);
  if (!isGalaxyId(next) || !isCount(score) || !isCount(lives) || lives < 1 || lives > RANK_MAX_LIVES) return null;
  if (tier === undefined || typeof continued !== 'boolean' || !isDate(startedAt)) return null;
  return { next, score, lives, weaponTier: tier, continued, startedAt };
}

function sanitizeEntry(raw: unknown): RankEntry | null {
  const entry = asRecord(raw);
  if (entry === null) return null;
  const { score, reached, date, continued } = entry;
  if (!isCount(score) || typeof reached !== 'string' || !REACHED.test(reached) || !isDate(date) || typeof continued !== 'boolean') return null;
  return { score, reached, date, continued };
}

function sanitizeBoard(raw: unknown): readonly RankEntry[] {
  const entries = Array.isArray(raw) ? raw.map(sanitizeEntry) : [];
  return entries.filter((e) => e !== null).reduce<readonly RankEntry[]>(addEntry, []);
}

/**
 * A save from whatever was stored. Each field is checked on its own, so one bad value costs only that
 * field; a newer `version` still keeps every field that validates. Never throws.
 */
export function sanitizeSave(raw: unknown): SaveData {
  const saved = asRecord(raw);
  if (saved === null) return defaultSave();
  const { frontier, classicBest, classicImported } = saved;
  return {
    version: 1,
    frontier: isGalaxyId(frontier) ? frontier : '1-1',
    galaxies: sanitizeGalaxies(saved['galaxies']),
    rankRun: sanitizeRankRun(saved['rankRun']),
    rankBoard: sanitizeBoard(saved['rankBoard']),
    classicBest: isCount(classicBest) ? classicBest : null,
    classicImported: classicImported === true,
  };
}

/** The stored text as a save; missing or corrupt text gives the defaults. */
export function parseSave(text: string | null): SaveData {
  if (text === null) return defaultSave();
  try {
    return sanitizeSave(JSON.parse(text));
  } catch {
    return defaultSave();
  }
}

/** The further of two galaxies in the run. */
export function furthest(a: GalaxyId, b: GalaxyId): GalaxyId {
  return galaxyOrdinal(b) > galaxyOrdinal(a) ? b : a;
}

function mergeProgress(a: GalaxyProgress | undefined, b: GalaxyProgress | undefined): GalaxyProgress | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  return { bestScore: Math.max(a.bestScore, b.bestScore), stars: Math.max(a.stars, b.stars) as GalaxyProgress['stars'] };
}

function mergeGalaxies(a: SaveData['galaxies'], b: SaveData['galaxies']): SaveData['galaxies'] {
  const out: Partial<Record<GalaxyId, GalaxyProgress>> = {};
  for (const { id } of GALAXIES) {
    const merged = mergeProgress(a[id], b[id]);
    if (merged !== undefined) out[id] = merged;
  }
  return out;
}

/** The run that got further: the later `next`, then the higher score. */
function mergeRuns(a: RankRun | null, b: RankRun | null): RankRun | null {
  if (a === null || b === null) return a ?? b;
  const byGalaxy = galaxyOrdinal(b.next) - galaxyOrdinal(a.next);
  return (byGalaxy || b.score - a.score) > 0 ? b : a;
}

function mergeBoards(a: readonly RankEntry[], b: readonly RankEntry[]): readonly RankEntry[] {
  const seen = new Set<string>();
  const fresh = [...a, ...b].filter((e) => {
    const key = `${String(e.score)}|${e.reached}|${e.date}|${String(e.continued)}`;
    return !seen.has(key) && seen.add(key);
  });
  return fresh.reduce<readonly RankEntry[]>(addEntry, []);
}

/**
 * Two saves as one that loses nothing from either, so a tab with a stale copy cannot undo another's
 * progress: the furthest frontier, the best of each galaxy, both boards' entries and the further Rank run.
 */
export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  return {
    version: 1,
    frontier: furthest(a.frontier, b.frontier),
    galaxies: mergeGalaxies(a.galaxies, b.galaxies),
    rankRun: mergeRuns(a.rankRun, b.rankRun),
    rankBoard: mergeBoards(a.rankBoard, b.rankBoard),
    classicBest: a.classicBest === null || b.classicBest === null ? (a.classicBest ?? b.classicBest) : Math.max(a.classicBest, b.classicBest),
    classicImported: a.classicImported || b.classicImported,
  };
}
