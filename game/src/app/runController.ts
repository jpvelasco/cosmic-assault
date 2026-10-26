import { galaxyById } from '../content/galaxies';
import type { SaveData } from '../meta/save';
import type { RingLog } from '../platform/log';
import { PLAYER } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { Field } from '../sim/field';
import { World } from '../sim/world';
import type { FlowCommand } from './commands';
import { localDate } from './date';
import { MENU_SCREENS, type FlowState, type Screen } from './flow';
import { createFlowController } from './flowController';
import { createSaveStore, type SaveStore, type StorageEvents } from './saveStore';
import { clockSeed, isDebugRun, type RunOverrides } from './seed';

export interface RunControllerDeps {
  /** Where the save lives; null where the browser refuses storage. */
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly overrides: RunOverrides;
  readonly log: RingLog;
  /** Storage events; defaults to `window`. */
  readonly events?: StorageEvents;
  /** The field a new run plays on, as of now; null while the game root has no size. */
  field(): Field | null;
  /** The flow is on a new screen; on a menu screen the run is already dropped. */
  showScreen(screen: Screen): void;
  /** A new World is in place: reset the input latches, the loop and the renderer for it. */
  onRunStarted(): void;
  /** Tells the player something in a toast. */
  notify(text: string): void;
}

export interface RunController {
  /** The run in play or on its end card; null on the title and menu screens. */
  readonly world: World | null;
  readonly flow: FlowState;
  /** The save in memory. A debug run (`?galaxy=`, `?seed=`, `?lives=`) never writes it to storage. */
  readonly save: SaveData;
  /** The score the run stands on: in Rank, the run's score so far plus this galaxy's; in Free play, the galaxy's. */
  readonly runTotal: number;
  readonly command: (command: FlowCommand) => void;
  /** Feeds one step's events to the flow: a clear or a game over moves it and writes the save at once. */
  handle(events: readonly SimEvent[]): void;
  pause(): void;
  resume(): void;
  /** Quits the paused run to the title; in Rank that forfeits the galaxy, at the cost of a life. */
  quit(): void;
  readonly onExternalChange: SaveStore['onExternalChange'];
  readonly onWriteFailure: SaveStore['onWriteFailure'];
}

/**
 * Owns the run: the save store (loaded, with the classic score imported once), the screen flow, and the World it
 * plays, built when the flow starts a run and dropped when it leaves for a menu screen.
 */
export function createRunController(deps: RunControllerDeps): RunController {
  const { overrides } = deps;
  // A debug run keeps its progress in memory: the real save is never written.
  const store = createSaveStore({
    storage: deps.storage,
    writes: !isDebugRun(overrides),
    log: deps.log,
    ...(deps.events === undefined ? {} : { events: deps.events }),
  });
  store.importClassicOnce();
  let world: World | null = null;

  /** Builds the World for the run the flow just started: its galaxy, in its mode, with a Rank run's lives. */
  function startRun({ galaxy, mode, rankRun }: FlowState): void {
    const field = deps.field();
    if (field === null) {
      throw new Error('Cannot start a run: the game root has no size yet; give #app a visible size before starting');
    }
    if (galaxy === null || mode === null) {
      throw new Error('Cannot start a run without a galaxy and a mode; start it through the flow (mode select or ?galaxy=)');
    }
    world = new World({
      seed: overrides.seed ?? clockSeed(),
      field,
      rules: { kind: 'galaxy', galaxy: galaxyById(galaxy), mode },
      // Free play always starts with the default lives; Rank carries its own.
      startLives: rankRun?.lives ?? PLAYER.startLives,
    });
    deps.onRunStarted();
  }

  /** Ends and forgets the run, if there is one; the canvas keeps its last frame under the menu. */
  function dropRun(): void {
    world?.endRun();
    world = null;
  }

  const flow = createFlowController({
    store,
    overrides,
    today: () => localDate(new Date()),
    startRun,
    showScreen: (screen) => {
      if (MENU_SCREENS.includes(screen)) dropRun();
      deps.showScreen(screen);
    },
    notify: (text) => {
      deps.notify(text);
    },
  });

  return {
    get world() {
      return world;
    },
    get flow() {
      return flow.state;
    },
    get save() {
      return store.save;
    },
    get runTotal() {
      const { result, rankRun } = flow.state;
      return result?.total ?? (rankRun?.score ?? 0) + (world?.score ?? 0);
    },
    command: flow.command,
    handle(events) {
      if (world !== null) flow.handle(events, world);
    },
    pause() {
      flow.dispatch({ kind: 'pause' });
    },
    resume() {
      flow.dispatch({ kind: 'resume' });
    },
    quit() {
      flow.dispatch({ kind: 'quit' });
    },
    onExternalChange: (callback) => store.onExternalChange(callback),
    onWriteFailure: (callback) => store.onWriteFailure(callback),
  };
}
