import { galaxyById } from '../content/galaxies';
import type { SaveData } from '../meta/save';
import type { RingLog } from '../platform/log';
import { createTabPresence, type TabPresence } from '../platform/tabPresence';
import { PLAYER } from '../sim/config';
import type { Controls } from '../sim/controls';
import type { SimEvent } from '../sim/events';
import type { Field } from '../sim/field';
import { hasEnded, World } from '../sim/world';
import type { FlowCommand } from './commands';
import { localDate } from './date';
import { END_SCREENS, MENU_SCREENS, type FlowState, type Screen } from './flow';
import { createFlowController } from './flowController';
import { createSaveStore, type StorageEvents } from './saveStore';
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
  /** One step's events, for the hit-stop, renderer and audio; the flow hears them after. */
  onEvents(events: readonly SimEvent[], world: World): void;
  /** Something the cards show changed outside a screen change: another tab's save, or the Rank lock. */
  refresh(): void;
  /** Which tab plays a Rank galaxy; defaults to one over `BroadcastChannel`. */
  readonly presence?: TabPresence;
}

/**
 * Whether the saved Rank run can be played here: `'free'`, `'checking'` while a probe asks the other tabs whether one
 * is playing it, or `'elsewhere'` when one answered.
 */
export type RankLock = 'free' | 'checking' | 'elsewhere';

/** While another tab plays the saved run, it is asked about again this often, in case that tab closed or crashed. */
export const RECHECK_MS = 5000;

/** The toast, once a session, when the save cannot be written. */
export const SAVE_FAILED_NOTICE = "Progress can't be saved in this browser";

export interface RunController {
  /** The run in play or on its end card; null on the title and menu screens. */
  readonly world: World | null;
  readonly flow: FlowState;
  /** The save in memory. A debug run (`?galaxy=`, `?seed=`, `?lives=`) never writes it to storage. */
  readonly save: SaveData;
  /** The score the run stands on: in Rank, the run's score so far plus this galaxy's; in Free play, the galaxy's. */
  readonly runTotal: number;
  readonly command: (command: FlowCommand) => void;
  readonly rankLock: RankLock;
  /** True while an end card is up over a World still warping out: the app keeps stepping it until it ends. */
  readonly warpingUnderCard: boolean;
  /** Steps the World by `dt`; its events go to `onEvents`, then to the flow (a clear or game over moves it at once). */
  step(dt: number, controls: Controls): void;
  pause(): void;
  resume(): void;
  /** Quits the paused run to the title; in Rank that forfeits the galaxy, at the cost of a life. */
  quit(): void;
  /** Stops answering for this tab's Rank galaxy and cancels any check, so nothing is forfeited afterwards. Also on a crash. */
  dispose(): void;
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
  const presence = deps.presence ?? createTabPresence();
  let world: World | null = null;
  let rankLock: RankLock = 'free';
  /** The answer to probes for the Rank galaxy this tab plays; a no-op while it plays none. */
  let releaseOwnership = (): void => undefined;
  let ownedSeq: number | null = null;
  /** Counts the checks of a run left mid-galaxy: only the newest acts on its probe's answer, and dispose bumps it too. */
  let checks = 0;
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

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
    liveRun: (runSeq) => {
      if (runSeq === ownedSeq) return;
      releaseOwnership();
      ownedSeq = runSeq;
      releaseOwnership = runSeq === null ? () => undefined : presence.own(runSeq);
      // This tab's own Rank start (or end) settles any check still waiting on the run it replaced.
      checkLeftRun();
    },
  });

  /** False until construction ends: the app's view does not exist yet, and reads the first lock as it is built. */
  let built = false;
  function setLock(lock: RankLock): void {
    if (lock === rankLock) return;
    rankLock = lock;
    if (built) deps.refresh();
  }

  /**
   * A run saved mid-galaxy is either another tab's live attempt or one left unfinished (a closed tab). Ask first: an
   * owner's answer locks it here, and it is asked again every `RECHECK_MS` in case that tab closed or crashed; silence
   * (or no channel) forfeits it. Runs again whenever another tab writes the save, and when this tab starts or ends a
   * Rank galaxy; a newer check overrides any still waiting.
   */
  function checkLeftRun(): void {
    void settleLeftRun();
  }

  async function settleLeftRun(): Promise<void> {
    const check = ++checks;
    clearTimeout(recheckTimer);
    const { rankRun, rankSeq } = store.save;
    if (rankRun?.inGalaxy !== true || ownedSeq !== null) {
      setLock('free');
      return;
    }
    setLock('checking');
    const owned = await presence.probe(rankSeq);
    // A newer check, or dispose, has superseded this one.
    if (check !== checks) return;
    // The run changed while the probe waited: ask about the run as it is now.
    if (store.save.rankSeq !== rankSeq) {
      checkLeftRun();
      return;
    }
    if (owned) {
      recheckTimer = setTimeout(checkLeftRun, RECHECK_MS);
      setLock('elsewhere');
      return;
    }
    // The forfeit re-checks inGalaxy inside its update, so a run another tab already forfeited loses no second life.
    flow.forfeitLeftRun();
    setLock('free');
  }
  checkLeftRun();
  built = true;
  const unlisteners = [
    // Another tab's write: this tab's map, galaxy select and Resume show it at once, and a run it left is re-checked.
    store.onExternalChange(() => {
      deps.refresh();
      checkLeftRun();
    }),
    store.onWriteFailure(() => {
      deps.notify(SAVE_FAILED_NOTICE);
    }),
  ];

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
    get rankLock() {
      return rankLock;
    },
    get warpingUnderCard() {
      return world !== null && END_SCREENS.includes(flow.state.screen) && !hasEnded(world.status);
    },
    command(command) {
      // The saved run is being checked, or is playing in another tab: it cannot be resumed here yet.
      if (command.kind === 'resumeRank' && rankLock !== 'free') return;
      flow.command(command);
    },
    step(dt, controls) {
      if (world === null) return;
      const events = world.step(dt, controls);
      deps.onEvents(events, world);
      flow.handle(events, world);
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
    dispose() {
      if (disposed) return;
      disposed = true;
      checks++;
      clearTimeout(recheckTimer);
      for (const unlisten of unlisteners) unlisten();
      releaseOwnership();
      presence.dispose();
    },
  };
}
