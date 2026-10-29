import { galaxyById, nextGalaxyId } from '../content/galaxies';
import type { Dimension, GalaxyDef, GalaxyId, WeaponTier } from '../content/types';
import { newBest, type BestsBefore, type NewBest } from '../meta/bests';
import { recordDailyClear } from '../meta/daily';
import { dailyGalaxy } from '../meta/dailyGalaxy';
import { abandonRankRun, endRankRun, forfeitRankRun, loseRankRun, rankEntry, recordClear, setRankRun } from '../meta/progress';
import { afterClear, afterGameOver, afterHit, type RankRun } from '../meta/rankRun';
import type { SaveData } from '../meta/save';
import { galaxyBestScore, type ClearReport, type GalaxyMode } from '../sim/scoring';

/**
 * The screen the app is on. Results, game over and Rank complete are the end screens of a run; confirmNewRank asks
 * before a new Rank run ends the saved one.
 */
export type Screen =
  | 'title'
  | 'modeSelect'
  | 'confirmNewRank'
  | 'map'
  | 'galaxySelect'
  | 'playing'
  | 'paused'
  | 'results'
  | 'gameOver'
  | 'rankComplete';

/** The screens that end a run; their input waits out the game-over guard. */
export const END_SCREENS: readonly Screen[] = ['results', 'gameOver', 'rankComplete'];
/** The screens with no run behind them. */
export const MENU_SCREENS: readonly Screen[] = ['title', 'modeSelect', 'confirmNewRank', 'map', 'galaxySelect'];

export interface FlowState {
  readonly screen: Screen;
  /** The mode chosen on mode select; null on the title and mode select. */
  readonly mode: GalaxyMode | null;
  /** The Dimension galaxy select shows; a Free play run moves it to the galaxy played. */
  readonly dimension: Dimension;
  /** The galaxy in play, or the one just played. */
  readonly galaxy: GalaxyId | null;
  /** In Rank, the run as carried into `galaxy`; on results, as carried into the next galaxy. Null outside Rank. */
  readonly rankRun: RankRun | null;
  /** In the Daily, the date it plays: read once as the run starts and kept for its retries. Null outside the Daily. */
  readonly daily: string | null;
  /** The last clear: its report and the score it leaves the run on (in Rank, the run's total). */
  readonly result: ClearResult | null;
  /**
   * The record the last end card's run beat, or null. Set on results, on Rank complete and on a Rank game over; a Free
   * game over beats nothing. Every run starts with none.
   */
  readonly newBest: NewBest | null;
  /** Counts the runs started; a change means the app must build a new World for `galaxy`. */
  readonly runs: number;
}

export interface ClearResult {
  readonly report: ClearReport;
  readonly total: number;
  /** The looks this clear unlocked, named for the results card, once the flow controller has written the save. */
  readonly newLooks?: readonly string[];
}

export type FlowAction =
  /** The title's Play. */
  | { readonly kind: 'start' }
  /** A new Rank run, from mode select (or its confirm card) or a `?galaxy=` switch with `?lives=`. */
  | { readonly kind: 'startRank'; readonly run: RankRun }
  /** Rank on mode select while a run is saved: ask first. */
  | { readonly kind: 'askNewRank' }
  /** The title's Resume Rank (or Continue Rank), with the run to play from the save. */
  | { readonly kind: 'resumeRank'; readonly run: RankRun }
  | { readonly kind: 'chooseFree' }
  /** The Daily Galaxy of `date`, today as mode select read it. */
  | { readonly kind: 'playDaily'; readonly date: string }
  | { readonly kind: 'openDimension'; readonly dimension: Dimension }
  /** A Free play run of `id`, from galaxy select or a `?galaxy=` switch on the title. */
  | { readonly kind: 'playGalaxy'; readonly id: GalaxyId }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  /** Quit from the pause card, with the ship on `livesLeft` and `weaponTier`: in Rank the galaxy is forfeited from them. */
  | { readonly kind: 'quit'; readonly livesLeft: number; readonly weaponTier: WeaponTier }
  /** The ship was hit and plays on with `livesLeft` and the `weaponTier` the hit left: in Rank the run keeps them, so leaving now forfeits from them. */
  | { readonly kind: 'hit'; readonly livesLeft: number; readonly weaponTier: WeaponTier }
  /**
   * The galaxy was cleared with `livesLeft` lives and the ship on `weaponTier`, which a Rank run carries on. `bests` are
   * the records as saved before this clear (`NO_BESTS` for a debug run).
   */
  | { readonly kind: 'clear'; readonly report: ClearReport; readonly livesLeft: number; readonly weaponTier: WeaponTier; readonly bests: BestsBefore }
  /** The last life went, with `score` won in this galaxy and the ship left on `weaponTier`; `bests` as for `clear`. */
  | { readonly kind: 'die'; readonly score: number; readonly weaponTier: WeaponTier; readonly bests: BestsBefore }
  /** Enter, or pad A, on an end screen: its first button. */
  | { readonly kind: 'confirm' }
  | { readonly kind: 'next' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'continue' }
  | { readonly kind: 'map' }
  | { readonly kind: 'title' }
  /** Esc, pad B or a Back button: one screen back. */
  | { readonly kind: 'back' };

export const INITIAL_FLOW: FlowState = { screen: 'title', mode: null, dimension: 1, galaxy: null, rankRun: null, daily: null, result: null, newBest: null, runs: 0 };

const dimensionOf = (id: GalaxyId): Dimension => galaxyById(id).dimension;

/** The galaxy Free play results offer as Next; null in Rank, off the results card or after 5-★. */
export function freeNext(state: FlowState): GalaxyId | null {
  return state.screen === 'results' && state.mode === 'free' && state.galaxy !== null ? nextGalaxyId(state.galaxy) : null;
}

/** A new run of `galaxy` in `mode`: nothing of the last run's end card carries into it. */
const newRun = (state: FlowState, mode: GalaxyMode, galaxy: GalaxyId): FlowState =>
  ({ ...state, screen: 'playing', mode, galaxy, rankRun: null, daily: null, result: null, newBest: null, runs: state.runs + 1 });

function playFree(state: FlowState, id: GalaxyId): FlowState {
  return { ...newRun(state, 'free', id), dimension: dimensionOf(id) };
}

/** Plays `run.next`; the run is marked as in its galaxy, so leaving it unfinished forfeits. */
function playRank(state: FlowState, run: RankRun): FlowState {
  return { ...newRun(state, 'rank', run.next), rankRun: { ...run, inGalaxy: true } };
}

/** Plays the Daily of `date` on the anchor galaxy it is built on, the date pinned for the run and its retries. */
function playDaily(state: FlowState, date: string): FlowState {
  return { ...newRun(state, 'daily', dailyGalaxy(date).def.id), daily: date };
}

/** The galaxy the run of `flow` plays: its date's Daily Galaxy in the Daily, else the galaxy itself; null with none chosen. */
export function runDef({ galaxy, daily }: Pick<FlowState, 'galaxy' | 'daily'>): GalaxyDef | null {
  if (daily !== null) return dailyGalaxy(daily).def;
  return galaxy === null ? null : galaxyById(galaxy);
}

/** The title, with nothing chosen; `runs` keeps counting. */
export const toTitle = (state: FlowState): FlowState => ({ ...INITIAL_FLOW, runs: state.runs });

function toMap(state: FlowState): FlowState {
  return { ...state, screen: 'map', mode: 'free', dimension: state.galaxy === null ? state.dimension : dimensionOf(state.galaxy) };
}

/** The Rank run's entry, at `total`, beating the board: the run's record. */
const runBest = (bests: BestsBefore, total: number): NewBest | null => newBest(bests, { kind: 'rankRun', score: total });

/** What the clear `report` of the galaxy in play counts toward its best (the galaxy's, or the Daily's): its score without Rank's multiplier. */
const bestScoreOf = ({ galaxy, mode }: FlowState, report: ClearReport): number =>
  galaxy === null ? report.score : galaxyBestScore(report, dimensionOf(galaxy), mode ?? 'free');

function cleared(state: FlowState, { report, livesLeft, weaponTier, bests }: Extract<FlowAction, { kind: 'clear' }>): FlowState {
  const { rankRun, galaxy } = state;
  if (galaxy === null) return state;
  // A Daily is judged against its date's best alone: the anchor galaxy's record is not its own.
  const clearBest = newBest(bests, { kind: state.daily === null ? 'galaxy' : 'daily', score: bestScoreOf(state, report) });
  if (state.mode !== 'rank' || rankRun === null) return { ...state, screen: 'results', result: { report, total: report.score }, newBest: clearBest };
  const total = rankRun.score + report.score;
  const next = afterClear(rankRun, galaxyById(galaxy), total, livesLeft, weaponTier);
  const result = { report, total };
  if (next === 'complete') return { ...state, screen: 'rankComplete', rankRun: null, result, newBest: runBest(bests, total) ?? clearBest };
  return { ...state, screen: 'results', rankRun: next, result, newBest: clearBest };
}

/** A Rank game over posts the run's total as its entry, so that total is what it may beat; a Free game over beats nothing. */
function died(state: FlowState, { score, weaponTier, bests }: Extract<FlowAction, { kind: 'die' }>): FlowState {
  const { rankRun } = state;
  const record = state.mode === 'rank' && rankRun !== null ? runBest(bests, rankRun.score + score) : null;
  return { ...state, screen: 'gameOver', rankRun: lostAt(rankRun, weaponTier), newBest: record };
}

/** Where an end screen's action leads in Free play; the state itself when the card does not offer it. */
function freeEnd(state: FlowState, kind: FlowAction['kind']): FlowState {
  const { galaxy } = state;
  if (galaxy === null) return state;
  const next = freeNext(state);
  switch (kind) {
    case 'next':
      return next === null ? state : playFree(state, next);
    // The card's first button: Next on results, Retry after a game over or the last galaxy.
    case 'confirm':
      return playFree(state, next ?? galaxy);
    case 'retry':
      return playFree(state, galaxy);
    case 'map':
    case 'back':
      return toMap(state);
    case 'title':
      return toTitle(state);
    default:
      return state;
  }
}

/** Where an end screen's action leads in Rank: on from results, Continue after a game over, the title from any. */
function rankEnd(state: FlowState, kind: FlowAction['kind']): FlowState {
  const { rankRun } = state;
  if (kind === 'title' || kind === 'back') return toTitle(state);
  if (rankRun === null) return kind === 'confirm' ? toTitle(state) : state;
  if (state.screen === 'results') return kind === 'next' || kind === 'confirm' ? playRank(state, rankRun) : state;
  return kind === 'continue' || kind === 'confirm' || kind === 'retry' ? playRank(state, afterGameOver(rankRun)) : state;
}

/** Where an end screen's action leads in the Daily: Enter, R and pad A play the same date again, Title and Back go to the title. */
function dailyEnd(state: FlowState, kind: FlowAction['kind']): FlowState {
  const { daily } = state;
  if (kind === 'title' || kind === 'back') return toTitle(state);
  return daily !== null && (kind === 'confirm' || kind === 'retry') ? playDaily(state, daily) : state;
}

/** The end screens' moves for each mode. */
const END_MOVES: Readonly<Record<GalaxyMode, (state: FlowState, kind: FlowAction['kind']) => FlowState>> = { rank: rankEnd, free: freeEnd, daily: dailyEnd };

/** The menu screens' moves; the state itself for anything a screen does not offer. */
function menuMove(state: FlowState, action: FlowAction): FlowState {
  switch (state.screen) {
    case 'title':
      if (action.kind === 'start') return { ...state, screen: 'modeSelect' };
      // startRank on the title comes only from the `?galaxy=` switch, as does playGalaxy: the title's own buttons are
      // Play and Resume Rank, and the controller sends these two only from `play()` with a switch in force.
      if (action.kind === 'resumeRank' || action.kind === 'startRank') return playRank(state, action.run);
      return action.kind === 'playGalaxy' ? playFree(state, action.id) : state;
    case 'modeSelect':
      if (action.kind === 'startRank' || action.kind === 'resumeRank') return playRank(state, action.run);
      if (action.kind === 'askNewRank') return { ...state, screen: 'confirmNewRank' };
      if (action.kind === 'chooseFree') return { ...state, screen: 'map', mode: 'free' };
      if (action.kind === 'playDaily') return playDaily(state, action.date);
      return action.kind === 'back' ? { ...state, screen: 'title', mode: null } : state;
    case 'confirmNewRank':
      if (action.kind === 'startRank') return playRank(state, action.run);
      return action.kind === 'back' ? { ...state, screen: 'modeSelect' } : state;
    case 'map':
      if (action.kind === 'openDimension') return { ...state, screen: 'galaxySelect', dimension: action.dimension };
      return action.kind === 'back' ? { ...state, screen: 'modeSelect', mode: null } : state;
    case 'galaxySelect':
      if (action.kind === 'playGalaxy') return playFree(state, action.id);
      return action.kind === 'back' ? { ...state, screen: 'map' } : state;
    default:
      return state;
  }
}

/** A run's own moves: pause, resume, quit, and the clear or game over that ends it. */
function runMove(state: FlowState, action: FlowAction): FlowState {
  const { screen } = state;
  switch (action.kind) {
    case 'pause':
      return screen === 'playing' ? { ...state, screen: 'paused' } : state;
    case 'resume':
      return screen === 'paused' ? { ...state, screen: 'playing' } : state;
    case 'quit':
      return screen === 'paused' ? toTitle(state) : state;
    case 'clear':
      return screen === 'playing' ? cleared(state, action) : state;
    case 'die':
      return screen === 'playing' ? died(state, action) : state;
    case 'hit':
      return hit(state, action.livesLeft, action.weaponTier);
    default:
      return state;
  }
}

/** The Rank run on its game over card: a Continue starts from the tier the fatal hit left. */
const lostAt = (run: RankRun | null, weaponTier: WeaponTier): RankRun | null => (run === null ? null : afterHit(run, run.lives, weaponTier));

/** A Rank run in play keeps the lives and tier the ship has left; the hit that takes the last life is the game over's to post. */
function hit(state: FlowState, livesLeft: number, weaponTier: WeaponTier): FlowState {
  const { rankRun } = state;
  if (state.screen !== 'playing' || state.mode !== 'rank' || rankRun === null || livesLeft <= 0 || livesLeft >= rankRun.lives) return state;
  return { ...state, rankRun: afterHit(rankRun, livesLeft, weaponTier) };
}

/**
 * The screen flow: title → mode select → map → galaxy select → playing → results or game over → on, again or back.
 * Pure: it never reads the clock or the save. An action a screen does not offer returns `state` itself.
 */
export function transition(state: FlowState, action: FlowAction): FlowState {
  switch (state.screen) {
    case 'playing':
    case 'paused':
      return runMove(state, action);
    case 'results':
    case 'gameOver':
    case 'rankComplete':
      return END_MOVES[state.mode ?? 'free'](state, action.kind);
    default:
      return menuMove(state, action);
  }
}

type Change = (save: SaveData) => SaveData;

/** What an action writes: progress every mode keeps, and the Rank run's own change, which a stale tab must not make. */
export interface SaveChange {
  /** A clear's best score, stars and unlock; in the Daily, its streak and best. */
  readonly record: Change | null;
  /** The Rank run started, carried on, forfeited, lost or ended, with its board entries. */
  readonly rank: Change | null;
}

const rankOnly = (rank: Change): SaveChange => ({ record: null, rank });

/**
 * What `action` (which took `before` to `after`) writes to the save, or null when it writes nothing. Clears are
 * recorded the moment they happen, and every Rank start, galaxy, end and Continue goes through `setRankRun`:
 * - each Rank galaxy saves the run marked as in it, so leaving it unfinished (Quit, a closed tab) forfeits a life;
 * - each hit in it saves the lives and weapon tier left, so that forfeit counts from them;
 * - a clear saves it between galaxies, at the next one, carrying the weapon tier; 5-★ posts the run and ends it;
 * - a game over posts the run total and keeps the run, with no lives, for a Continue.
 */
/** `today` gives the local date; it is read only by a change that dates something (a board entry or forfeit). */
export function saveChange(before: FlowState, action: FlowAction, after: FlowState, today: () => string): SaveChange | null {
  if (after === before) return null;
  const run = before.mode === 'rank' ? before.rankRun : null;
  if (after.runs !== before.runs && after.mode === 'rank') {
    const started = after.rankRun;
    if (started === null) return null;
    return rankOnly((save) => setRankRun(action.kind === 'startRank' ? abandonRankRun(save, today()) : save, started));
  }
  switch (action.kind) {
    case 'clear': {
      const { galaxy, result } = after;
      if (galaxy === null || result === null) return null;
      const date = before.daily;
      const best = bestScoreOf(before, action.report);
      // A Daily clear writes the Daily record alone, for the date the run began on.
      if (date !== null) return { record: (save) => recordDailyClear(save, date, best), rank: null };
      const record: Change = (save) => recordClear(save, galaxyById(galaxy), best, action.report.stars);
      if (run === null) return { record, rank: null };
      const next = after.rankRun;
      return { record, rank: next === null ? (save) => endRankRun(save, rankEntry(run, result.total, today()), null) : (save) => setRankRun(save, next) };
    }
    case 'die':
      return run === null ? null : rankOnly((save) => loseRankRun(save, run, action.score, today(), action.weaponTier));
    case 'hit': {
      const next = after.rankRun;
      return next === null ? null : rankOnly((save) => setRankRun(save, next));
    }
    case 'quit':
      return run === null ? null : rankOnly((save) => forfeitRankRun(save, run, action.livesLeft, today(), action.weaponTier));
    default:
      return null;
  }
}

/**
 * Applies `change` to `save` (the stored save, merged) for a tab that last saw the Rank run at `knownSeq`. When another
 * tab has moved the run on since (a higher stored `rankSeq`), the Rank part is left out and `stale` is set; the
 * progress part is always kept.
 */
export function applySaveChange(save: SaveData, change: SaveChange, knownSeq: number): { readonly save: SaveData; readonly stale: boolean } {
  const recorded = change.record === null ? save : change.record(save);
  if (change.rank === null) return { save: recorded, stale: false };
  if (save.rankSeq > knownSeq) return { save: recorded, stale: true };
  return { save: change.rank(recorded), stale: false };
}
