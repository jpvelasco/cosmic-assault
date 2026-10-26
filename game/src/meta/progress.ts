import { furthest, galaxyOrdinal, nextGalaxyId } from '../content/galaxies';
import type { Dimension, GalaxyDef, GalaxyId } from '../content/types';
import type { RankRun } from './rankRun';
import { MAX_RANK_SEQ, type GalaxyProgress, type SaveData } from './save';

/** The save after winning `cleared`: its best score and stars kept, and the next galaxy (a boss clear opens the next Dimension) unlocked. Shared by every mode. */
export function recordClear(save: SaveData, cleared: GalaxyDef, score: number, stars: 1 | 2 | 3): SaveData {
  const before = save.galaxies[cleared.id];
  const best: GalaxyProgress = { bestScore: Math.max(before?.bestScore ?? 0, score), stars: Math.max(before?.stars ?? 0, stars) as GalaxyProgress['stars'] };
  return { ...save, frontier: furthest(save.frontier, nextGalaxyId(cleared.id) ?? cleared.id), galaxies: { ...save.galaxies, [cleared.id]: best } };
}

export function isUnlocked(save: SaveData, id: GalaxyId): boolean {
  return galaxyOrdinal(id) <= galaxyOrdinal(save.frontier);
}

/** Stars won in Dimension `d`, out of 18. */
export function dimensionStars(save: SaveData, d: Dimension): number {
  return Object.entries(save.galaxies)
    .filter(([id]) => id.startsWith(`${String(d)}-`))
    .reduce((sum, [, progress]) => sum + progress.stars, 0);
}

/** Starts a Rank run (`run`), ends one (`null`) or continues one (the continued run). Every such change goes through here so `rankSeq` always moves with it (until it reaches `MAX_RANK_SEQ`). */
export function setRankRun(save: SaveData, run: RankRun | null): SaveData {
  return { ...save, rankRun: run, rankSeq: Math.min(save.rankSeq + 1, MAX_RANK_SEQ) };
}
