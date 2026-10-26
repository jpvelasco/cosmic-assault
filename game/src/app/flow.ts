import { galaxyById, nextGalaxyId } from '../content/galaxies';
import type { Dimension, GalaxyId } from '../content/types';
import { abandonRankRun, endRankRun, forfeitRankRun, loseRankRun, rankEntry, recordClear, setRankRun } from '../meta/progress';
import { afterClear, afterGameOver, type RankRun } from '../meta/rankRun';
import type { SaveData } from '../meta/save';
import type { ClearReport, GalaxyMode } from '../sim/scoring';

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
  /** The last clear: its report, the score it leaves the run on (in Rank, the run's total), and whether it beat the galaxy's best. */
  readonly result: ClearResult | null;
  /** Counts the runs started; a change means the app must build a new World for `galaxy`. */
  readonly runs: number;
}

export interface ClearResult {
  readonly report: ClearReport;
  readonly total: number;
  /** The clear's score beat the best the save held for the galaxy before it. */
  readonly newBest: boolean;
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
  | { readonly kind: 'openDimension'; readonly dimension: Dimension }
  /** A Free play run of `id`, from galaxy select or a `?galaxy=` switch on the title. */
  | { readonly kind: 'playGalaxy'; readonly id: GalaxyId }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'quit' }
  /** The galaxy was cleared with `livesLeft` lives; `bestBefore` is its best score as saved before this clear (0 for none). */
  | { readonly kind: 'clear'; readonly report: ClearReport; readonly livesLeft: number; readonly bestBefore: number }
  /** The last life went, with `score` won in this galaxy. */
  | { readonly kind: 'die'; readonly score: number }
  /** Enter, or pad A, on an end screen: its first button. */
  | { readonly kind: 'confirm' }
  | { readonly kind: 'next' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'continue' }
  | { readonly kind: 'map' }
  | { readonly kind: 'title' }
  /** Esc, pad B or a Back button: one screen back. */
  | { readonly kind: 'back' };

export const INITIAL_FLOW: FlowState = { screen: 'title', mode: null, dimension: 1, galaxy: null, rankRun: null, result: null, runs: 0 };

const dimensionOf = (id: GalaxyId): Dimension => galaxyById(id).dimension;

/** The galaxy Free play results offer as Next; null in Rank, off the results card or after 5-★. */
export function freeNext(state: FlowState): GalaxyId | null {
  return state.screen === 'results' && state.mode === 'free' && state.galaxy !== null ? nextGalaxyId(state.galaxy) : null;
}

function playFree(state: FlowState, id: GalaxyId): FlowState {
  return { ...state, screen: 'playing', mode: 'free', galaxy: id, dimension: dimensionOf(id), rankRun: null, result: null, runs: state.runs + 1 };
}

/** Plays `run.next`; the run is marked as in its galaxy, so leaving it unfinished forfeits. */
function playRank(state: FlowState, run: RankRun): FlowState {
  return { ...state, screen: 'playing', mode: 'rank', galaxy: run.next, rankRun: { ...run, inGalaxy: true }, result: null, runs: state.runs + 1 };
}

/** The title, with nothing chosen; `runs` keeps counting. */
export const toTitle = (state: FlowState): FlowState => ({ ...INITIAL_FLOW, runs: state.runs });

function toMap(state: FlowState): FlowState {
  return { ...state, screen: 'map', mode: 'free', dimension: state.galaxy === null ? state.dimension : dimensionOf(state.galaxy) };
}

function cleared(state: FlowState, { report, livesLeft, bestBefore }: Extract<FlowAction, { kind: 'clear' }>): FlowState {
  const { rankRun, galaxy } = state;
  if (galaxy === null) return state;
  const newBest = report.score > bestBefore;
  if (state.mode !== 'rank' || rankRun === null) return { ...state, screen: 'results', result: { report, total: report.score, newBest } };
  const total = rankRun.score + report.score;
  const next = afterClear(rankRun, galaxyById(galaxy), total, livesLeft);
  const result = { report, total, newBest };
  return next === 'complete' ? { ...state, screen: 'rankComplete', rankRun: null, result } : { ...state, screen: 'results', rankRun: next, result };
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
      return screen === 'playing' ? { ...state, screen: 'gameOver' } : state;
    default:
      return state;
  }
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
      return state.mode === 'rank' ? rankEnd(state, action.kind) : freeEnd(state, action.kind);
    default:
      return menuMove(state, action);
  }
}

type Change = (save: SaveData) => SaveData;

/** What an action writes: progress every mode keeps, and the Rank run's own change, which a stale tab must not make. */
export interface SaveChange {
  /** A clear's best score, stars and unlock. */
  readonly record: Change | null;
  /** The Rank run started, carried on, forfeited, lost or ended, with its board entries. */
  readonly rank: Change | null;
}

const rankOnly = (rank: Change): SaveChange => ({ record: null, rank });

/**
 * What `action` (which took `before` to `after`) writes to the save, or null when it writes nothing. Clears are
 * recorded the moment they happen, and every Rank start, galaxy, end and Continue goes through `setRankRun`:
 * - each Rank galaxy saves the run marked as in it, so leaving it unfinished (Quit, a closed tab) forfeits a life;
 * - a clear saves it between galaxies, at the next one; 5-★ posts the run and ends it;
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
      const record: Change = (save) => recordClear(save, galaxyById(galaxy), action.report.score, action.report.stars);
      if (run === null) return { record, rank: null };
      const next = after.rankRun;
      return { record, rank: next === null ? (save) => endRankRun(save, rankEntry(run, result.total, today()), null) : (save) => setRankRun(save, next) };
    }
    case 'die':
      return run === null ? null : rankOnly((save) => loseRankRun(save, run, action.score, today()));
    case 'quit':
      return run === null ? null : rankOnly((save) => forfeitRankRun(save, run, today()));
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
