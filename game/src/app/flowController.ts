import { galaxyIdOf, type GalaxyId } from '../content/types';
import { bestsBefore, NO_BESTS, type BestsBefore } from '../meta/bests';
import { newlyUnlocked } from '../meta/cosmetics';
import { forfeitRankRun, isUnlocked } from '../meta/progress';
import { afterGameOver, startRank, type RankRun } from '../meta/rankRun';
import type { SaveData } from '../meta/save';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import type { FlowCommand } from './commands';
import { applySaveChange, INITIAL_FLOW, saveChange, toTitle, transition, type FlowAction, type FlowState, type SaveChange, type Screen } from './flow';
import type { SaveStore } from './saveStore';
import type { RunOverrides } from './seed';

/** The toast when another tab has moved this tab's Rank run on. */
export const STALE_RUN_NOTICE = 'This run continued in another tab';
/** The toast when a new Rank run is not started because another tab changed the saved one meanwhile. */
export const STALE_NEW_RUN_NOTICE = 'Another tab changed your Rank run; try again';

export interface FlowControllerDeps {
  readonly store: SaveStore;
  readonly overrides: Pick<RunOverrides, 'galaxy' | 'startLives'>;
  /** The local date, `YYYY-MM-DD`. */
  today(): string;
  /** The flow has just started a run of `flow.galaxy`: build its World. Called before `showScreen('playing')`. */
  startRun(flow: FlowState): void;
  showScreen(screen: Screen): void;
  /** Tells the player something in a toast. */
  notify(text: string): void;
  /** After each move: the `rankSeq` of the Rank galaxy this tab is now playing, or null when it plays none. */
  liveRun?(runSeq: number | null): void;
}

export interface FlowController {
  readonly state: FlowState;
  /** A key, pad or button command; a locked Dimension or galaxy is ignored. */
  readonly command: (command: FlowCommand) => void;
  dispatch(action: FlowAction): void;
  /** Feeds one step's events: a clear or a game over moves the flow and writes the save at once, as does a Rank hit. */
  handle(events: readonly SimEvent[], world: Pick<World, 'lives' | 'weaponTier'>): void;
  /**
   * Forfeits a saved run left mid-galaxy (a closed tab), once the caller knows no other tab is playing it at `probedSeq`, the
   * `rankSeq` it asked about; true if it took a life. A run another tab has moved on since is left alone.
   */
  forfeitLeftRun(probedSeq: number): boolean;
}

/** A clear's result, naming the looks its save write unlocked. */
function namingUnlocks(state: FlowState, before: SaveData, after: SaveData): FlowState {
  return state.result === null ? state : { ...state, result: { ...state.result, newLooks: newlyUnlocked(before, after) } };
}

/**
 * Owns the flow state: turns commands into flow actions, writes what each one saves, and tells the app what to show.
 * Rank writes are guarded against other tabs: the controller remembers the `rankSeq` it last saw the run at, and a
 * write that finds a higher one stored is dropped.
 */
export function createFlowController(deps: FlowControllerDeps): FlowController {
  const { store, overrides } = deps;
  let state = INITIAL_FLOW;

  /** The `rankSeq` this tab last saw its Rank run at: loaded, written, or shown on the title. */
  let knownSeq = store.save.rankSeq;

  function forfeitLeftRun(probedSeq: number): boolean {
    if (store.save.rankRun?.inGalaxy !== true) return false;
    let forfeited = false;
    store.update((save) => {
      const run = save.rankRun;
      // Re-checked on the save as stored now: a run another tab already forfeited loses no second life, and one it
      // wrote to since the probe (a hit, whose storage event may not have reached this tab yet) is still being played.
      forfeited = run?.inGalaxy === true && save.rankSeq === probedSeq;
      return run !== null && forfeited ? forfeitRankRun(save, run, run.lives, deps.today(), run.weaponTier) : save;
    });
    knownSeq = store.save.rankSeq;
    return forfeited;
  }

  /** Writes `change`; returns false when another tab had moved the Rank run on, so its Rank part was dropped. */
  function write(change: SaveChange): boolean {
    const outcome = { stale: false };
    store.update((save) => {
      const applied = applySaveChange(save, change, knownSeq);
      outcome.stale = applied.stale;
      return applied.save;
    });
    if (!outcome.stale && change.rank !== null) knownSeq = store.save.rankSeq;
    return !outcome.stale;
  }

  function show(before: FlowState, after: FlowState): void {
    state = after;
    const live = after.mode === 'rank' && (after.screen === 'playing' || after.screen === 'paused');
    deps.liveRun?.(live ? knownSeq : null);
    if (after.runs !== before.runs) deps.startRun(after);
    if (after.screen !== before.screen) deps.showScreen(after.screen);
  }

  function dispatch(action: FlowAction): void {
    const before = state;
    const after = transition(before, action);
    if (after === before) return;
    // On the title the player sees the run as the save has it now, other tabs' changes included; Resume plays it so.
    if (before.screen === 'title' || action.kind === 'resumeRank') knownSeq = store.save.rankSeq;
    const change = saveChange(before, action, after, () => deps.today());
    const saveBefore = store.save;
    if (change !== null && !write(change)) {
      deps.notify(action.kind === 'startRank' ? STALE_NEW_RUN_NOTICE : STALE_RUN_NOTICE);
      show(before, toTitle(before));
      return;
    }
    show(before, action.kind === 'clear' ? namingUnlocks(after, saveBefore, store.save) : after);
  }

  /** A new Rank run, at `from`; `?lives=` sets its lives. */
  function newRank(from: GalaxyId = '1-1'): RankRun {
    const run = startRank(deps.today());
    return { ...run, next: from, lives: overrides.startLives ?? run.lives };
  }

  /** The title's Play: mode select, or with `?galaxy=` straight into it (as Rank when `?lives=` is given too). */
  function play(): FlowAction {
    const { galaxy } = overrides;
    if (galaxy === undefined) return { kind: 'start' };
    return overrides.startLives === undefined ? { kind: 'playGalaxy', id: galaxy } : { kind: 'startRank', run: newRank(galaxy) };
  }

  /** Resume Rank plays the saved run on; a lost one (no lives) is a Continue: score back to 0, and marked. */
  function resume(): FlowAction | null {
    const run = store.save.rankRun;
    if (run === null) return null;
    return { kind: 'resumeRank', run: run.lives === 0 ? afterGameOver(run) : run };
  }

  /** Rank on mode select asks first when a run is saved; Rank on that confirm card starts the new run. */
  function chooseRank(): FlowAction {
    return state.screen === 'modeSelect' && store.save.rankRun !== null ? { kind: 'askNewRank' } : { kind: 'startRank', run: newRank() };
  }

  function actionFor(command: FlowCommand): FlowAction | null {
    switch (command.kind) {
      case 'start':
        return play();
      case 'resumeRank':
        return resume();
      case 'chooseMode':
        return command.mode === 'rank' ? chooseRank() : { kind: 'chooseFree' };
      case 'openDimension':
        return isUnlocked(store.save, galaxyIdOf(command.dimension, 1)) ? command : null;
      case 'openGalaxy':
        return isUnlocked(store.save, command.id) ? { kind: 'playGalaxy', id: command.id } : null;
      default:
        return command;
    }
  }

  /**
   * The records as saved now, before a clear or game over is written, for its "New best!". A debug run (a store that
   * never writes) keeps none, so it never beats one.
   */
  const bests = (): BestsBefore => (store.writes ? bestsBefore(store.save, state.galaxy) : NO_BESTS);

  function handle(events: readonly SimEvent[], world: Pick<World, 'lives' | 'weaponTier'>): void {
    for (const event of events) {
      if (event.type === 'galaxyCleared') {
        const { score, bonus, deaths, stars } = event;
        dispatch({ kind: 'clear', report: { score, bonus, deaths, stars }, livesLeft: world.lives, weaponTier: world.weaponTier, bests: bests() });
      } else if (event.type === 'gameOver') {
        dispatch({ kind: 'die', score: event.score, weaponTier: world.weaponTier, bests: bests() });
      } else if (event.type === 'shipHit') {
        // The tier is read after the whole step. A core taken on the hit's own step (needing a pickup at the respawn
        // point) leaves it one above what the death did; that rare case is accepted.
        dispatch({ kind: 'hit', livesLeft: event.livesLeft, weaponTier: world.weaponTier });
      }
    }
  }

  return {
    get state() {
      return state;
    },
    command(command) {
      const action = actionFor(command);
      if (action !== null) dispatch(action);
    },
    dispatch,
    handle,
    forfeitLeftRun,
  };
}
