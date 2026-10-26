import { galaxyIdOf } from '../content/galaxies';
import type { GalaxyId } from '../content/types';
import { isUnlocked } from '../meta/progress';
import { startRank, type RankRun } from '../meta/rankRun';
import { STEP_SECONDS } from '../sim/config';
import { NO_CONTROLS } from '../sim/controls';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import type { FlowCommand } from './commands';
import { INITIAL_FLOW, saveChange, transition, type FlowAction, type FlowState, type Screen } from './flow';
import type { SaveStore } from './saveStore';
import type { RunOverrides } from './seed';

export interface FlowControllerDeps {
  readonly store: SaveStore;
  readonly overrides: Pick<RunOverrides, 'galaxy' | 'startLives'>;
  /** The local date, `YYYY-MM-DD`. */
  today(): string;
  /** The flow has just started a run of `flow.galaxy`: build its World. Called before `showScreen('playing')`. */
  startRun(flow: FlowState): void;
  showScreen(screen: Screen): void;
}

export interface FlowController {
  readonly state: FlowState;
  /** A key, pad or button command; a locked Dimension or galaxy is ignored. */
  readonly command: (command: FlowCommand) => void;
  dispatch(action: FlowAction): void;
  /** Feeds one step's events: a clear or a game over moves the flow and writes the save at once. */
  handle(events: readonly SimEvent[], world: Pick<World, 'lives'>): void;
  /** Quits the paused run to the title. A run warping out is finished first, so its clear is kept. */
  quit(world: World): void;
}

/** Owns the flow state: turns commands into flow actions, writes what each one saves, and tells the app what to show. */
export function createFlowController(deps: FlowControllerDeps): FlowController {
  const { store, overrides } = deps;
  let state = INITIAL_FLOW;

  function dispatch(action: FlowAction): void {
    const before = state;
    const after = transition(before, action);
    if (after === before) return;
    const change = saveChange(before, action, after, deps.today());
    if (change !== null) store.update(change);
    state = after;
    if (after.runs !== before.runs) deps.startRun(after);
    if (after.screen !== before.screen) deps.showScreen(after.screen);
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

  function actionFor(command: FlowCommand): FlowAction | null {
    switch (command.kind) {
      case 'start':
        return play();
      case 'resumeRank': {
        const run = store.save.rankRun;
        return run === null ? null : { kind: 'resumeRank', run };
      }
      case 'chooseMode':
        return command.mode === 'rank' ? { kind: 'startRank', run: newRank() } : { kind: 'chooseFree' };
      case 'openDimension':
        return isUnlocked(store.save, galaxyIdOf(command.dimension, 1)) ? command : null;
      case 'openGalaxy':
        return isUnlocked(store.save, command.id) ? { kind: 'playGalaxy', id: command.id } : null;
      default:
        return command;
    }
  }

  function handle(events: readonly SimEvent[], world: Pick<World, 'lives'>): void {
    for (const event of events) {
      if (event.type === 'galaxyCleared') {
        const { score, bonus, deaths, stars } = event;
        dispatch({ kind: 'clear', report: { score, bonus, deaths, stars }, livesLeft: world.lives });
      } else if (event.type === 'gameOver') {
        dispatch({ kind: 'die', score: event.score });
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
    quit(world) {
      // The ship cannot be hit while warping, so the rest of the warp needs no input to end in the clear.
      while (world.status === 'warping') handle(world.step(STEP_SECONDS, NO_CONTROLS), world);
      dispatch(state.screen === 'paused' ? { kind: 'quit' } : { kind: 'title' });
    },
  };
}
