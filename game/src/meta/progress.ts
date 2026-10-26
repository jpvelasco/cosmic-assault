import { furthest, galaxyOrdinal, nextGalaxyId } from '../content/galaxies';
import type { Dimension, GalaxyDef, GalaxyId } from '../content/types';
import { addEntry, reachedLabel, type RankEntry } from './rankBoard';
import { afterForfeit, type RankRun } from './rankRun';
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

/** The board entry for `run` ending on `score` on `today`, marked if it used Continue. */
export function rankEntry(run: RankRun, score: number, today: string): RankEntry {
  return { score, reached: reachedLabel(run.next), date: today, continued: run.continued };
}

/** Posts `entry` to the board and ends the run (`null`), or leaves it waiting, lost, for a Continue (`run` with no lives). */
export function endRankRun(save: SaveData, entry: RankEntry, run: RankRun | null): SaveData {
  return setRankRun({ ...save, rankBoard: addEntry(save.rankBoard, entry) }, run);
}

/** `run`, saved at the start of its galaxy, lost there: its entry posted at the score it carried in plus `galaxyScore`. */
export function loseRankRun(save: SaveData, run: RankRun, galaxyScore: number, today: string): SaveData {
  return endRankRun(save, rankEntry(run, run.score + galaxyScore, today), { ...run, lives: 0, inGalaxy: false });
}

/** `run`'s galaxy left unfinished with `livesLeft`: one more life lost; on the last life the run is lost as at a game over, at its saved score. */
export function forfeitRankRun(save: SaveData, run: RankRun, livesLeft: number, today: string): SaveData {
  const next = afterForfeit(run, livesLeft);
  return next.lives > 0 ? setRankRun(save, next) : loseRankRun(save, run, 0, today);
}

/** The save with its Rank run given up for a new one: a run still alive posts its board entry first, as it stands. */
export function abandonRankRun(save: SaveData, today: string): SaveData {
  const old = save.rankRun;
  return old === null || old.lives === 0 ? save : { ...save, rankBoard: addEntry(save.rankBoard, rankEntry(old, old.score, today)) };
}
