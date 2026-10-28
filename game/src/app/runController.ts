import { galaxyById } from '../content/galaxies';
import type { GalaxyDef } from '../content/types';
import { recordPickupSeen } from '../meta/progress';
import type { SaveData } from '../meta/save';
import type { RingLog } from '../platform/log';
import { createTabPresence, type TabPresence } from '../platform/tabPresence';
import { PLAYER } from '../sim/config';
import type { Controls } from '../sim/controls';
import type { SimEvent } from '../sim/events';
import type { Field } from '../sim/field';
import { hasEnded, World } from '../sim/world';
import { CALLOUT_MS } from '../ui/toast';
import type { FlowCommand } from './commands';
import { localDate } from './date';
import { END_SCREENS, MENU_SCREENS, type FlowState, type Screen } from './flow';
import { createFlowController } from './flowController';
import { createPickupNotices } from './pickupNotices';
import { createSaveStore, type StorageEvents } from './saveStore';
import { clockSeed, isDebugRun, playedGalaxy, type RunOverrides } from './seed';

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
  /** A new World is in place, playing `galaxy`: reset the input latches, the loop and the renderer for it, in its palette. */
  onRunStarted(galaxy: GalaxyDef): void;
  /** Tells the player something in a toast, up for `ms` (the toast's default when omitted). */
  notify(text: string, ms?: number): void;
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

/** The toast when a Rank run left mid-galaxy (a closed or discarded tab) is forfeited at boot or on a recheck. */
export const LEFT_RUN_NOTICE = 'Your Rank run lost a life: it was left mid-galaxy';

/** The toast, once a session, when the save cannot be written. */
export const SAVE_FAILED_NOTICE = "Progress can't be saved in this browser";

export interface RunController {
  /** The run in play or on its end card; null on the title and menu screens. */
  readonly world: World | null;
  readonly flow: FlowState;
  /** The save in memory. A debug run (`?galaxy=`, `?seed=`, `?lives=`, `?storm=`) never writes it to storage. */
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
  const notices = createPickupNotices({
    seen: () => store.save.seenPickups,
    markSeen: (kind) => {
      store.update((save) => recordPickupSeen(save, kind));
    },
    notify: (text) => {
      deps.notify(text, CALLOUT_MS);
    },
  });
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

  /** Builds the World for the run the flow just started: its galaxy, in its mode, with a Rank run's lives and weapon. */
  function startRun({ galaxy, mode, rankRun }: FlowState): void {
    const field = deps.field();
    if (field === null) {
      throw new Error('Cannot start a run: the game root has no size yet; give #app a visible size before starting');
    }
    if (galaxy === null || mode === null) {
      throw new Error('Cannot start a run without a galaxy and a mode; start it through the flow, from mode select or galaxy select');
    }
    const def = playedGalaxy(galaxyById(galaxy), overrides.storm);
    world = new World({
      seed: overrides.seed ?? clockSeed(),
      field,
      rules: { kind: 'galaxy', galaxy: def, mode },
      // Free play always starts with the default lives and weapon; Rank carries its own.
      startLives: rankRun?.lives ?? PLAYER.startLives,
      startTier: rankRun?.weaponTier ?? 0,
    });
    notices.newRun();
    deps.onRunStarted(def);
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
   * Rank galaxy; a newer check overrides any still waiting. A check after another tab's write (`afterWrite`) that
   * meets silence asks once more, `RECHECK_MS` later, before it forfeits: the owner may be busy starting its galaxy.
   */
  function checkLeftRun(afterWrite = false): void {
    void settleLeftRun(afterWrite);
  }

  async function settleLeftRun(afterWrite: boolean): Promise<void> {
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
      checkLeftRun(afterWrite);
      return;
    }
    if (owned) {
      recheckTimer = setTimeout(checkLeftRun, RECHECK_MS);
      setLock('elsewhere');
      return;
    }
    if (afterWrite) {
      recheckTimer = setTimeout(checkLeftRun, RECHECK_MS);
      return;
    }
    // The forfeit re-checks inGalaxy and rankSeq inside its update: a run another tab already forfeited loses no second
    // life, and one it has written to since the probe is still live.
    if (flow.forfeitLeftRun(rankSeq)) {
      deps.notify(LEFT_RUN_NOTICE);
    } else if (store.save.rankSeq !== rankSeq) {
      // The forfeit found the run written to since the probe: another tab is playing it. Ask about it as it is now.
      checkLeftRun();
      return;
    }
    setLock('free');
  }
  checkLeftRun();
  built = true;
  const unlisteners = [
    // Another tab's write: this tab's map, galaxy select and Resume show it at once, and a run it left is re-checked.
    store.onExternalChange(() => {
      deps.refresh();
      checkLeftRun(true);
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
      notices.handle(events);
      flow.handle(events, world);
    },
    pause() {
      flow.dispatch({ kind: 'pause' });
    },
    resume() {
      flow.dispatch({ kind: 'resume' });
    },
    quit() {
      if (world !== null) flow.dispatch({ kind: 'quit', livesLeft: world.lives, weaponTier: world.weaponTier });
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
