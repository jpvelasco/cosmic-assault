import { botRng } from '../bot/create';
import { createExpert } from '../bot/expert';
import { createView, readView, type Bot, type BotView } from '../bot/view';
import { galaxyById } from '../content/galaxies';
import type { GalaxyId, PaletteId } from '../content/types';
import { describeError } from '../platform/crashGuard';
import type { RingLog } from '../platform/log';
import type { Renderer } from '../render/renderer';
import type { Field } from '../sim/field';
import { createFixedStepLoop, visualFrameSeconds } from '../sim/loop';
import { hasEnded, World } from '../sim/world';
import type { Screen } from './flow';

/** Seconds without input on the bare title before a demo plays. */
export const ATTRACT_IDLE_SECONDS = 10;
/** The longest a demo plays before the next one. */
export const DEMO_SECONDS = 45;
/** The still pause between one demo's end and the next one's start. */
export const DEMO_GAP_SECONDS = 1;

/** A demo: a galaxy the expert bot flies in Free play, on a World seed of its own. */
export interface AttractDemo {
  readonly galaxy: GalaxyId;
  readonly seed: number;
}

/**
 * The demos, in the order they play, round and round. Each seed's expert loses no life in the first DEMO_SECONDS at
 * 16:9, 4:3 and 21:9 (the claim `attract-<galaxy>` in tests/helpers/seedClaims.ts); when it breaks, the guard test
 * prints the `npm run find-seeds -- attract-<galaxy>` command that re-picks it.
 */
export const ATTRACT_DEMOS: readonly AttractDemo[] = [
  { galaxy: '1-3', seed: 2 },
  { galaxy: '2-2', seed: 1 },
  { galaxy: '1-4', seed: 1 },
  { galaxy: '2-4', seed: 1 },
];

/** What decides whether a demo may play now. */
export interface IdleState {
  readonly screen: Screen;
  /** Whether a card or prompt is over the screen: settings, records, the Hangar, the install prompt, the rotate prompt or the crash card. */
  readonly covered: boolean;
  readonly visible: boolean;
  readonly reducedMotion: boolean;
  readonly portrait: boolean;
  /** Seconds the bare title has gone without input. */
  readonly idleSeconds: number;
}

/** Whether a demo may play behind the screen: the bare title, uncovered, in a visible landscape page with motion allowed. */
export function attractAllowed({ screen, covered, visible, reducedMotion, portrait }: Readonly<IdleState>): boolean {
  return screen === 'title' && !covered && visible && !reducedMotion && !portrait;
}

/** Whether a demo should start: the bare title has gone ATTRACT_IDLE_SECONDS without input. */
export function attractDue(state: Readonly<IdleState>): boolean {
  return attractAllowed(state) && state.idleSeconds >= ATTRACT_IDLE_SECONDS;
}

/** What attract mode needs: the renderer to draw the demo with, the log for a crash, and the screen's state. No save, flow, notices or audio. */
export interface AttractDeps {
  readonly renderer: Pick<Renderer, 'handle' | 'advance' | 'settle' | 'draw' | 'reset' | 'setPalette' | 'palette'>;
  readonly log: Pick<RingLog, 'add'>;
  /** The play field, or null before the page has a size. */
  field(): Field | null;
  screen(): Screen;
  covered(): boolean;
  visible(): boolean;
  reducedMotion(): boolean;
  portrait(): boolean;
  now(): number;
  /** A demo World is in place: its first frames bake its sprites. */
  demoStarted(): void;
  /** Attract mode turned on or off: the title card's look follows `active`. */
  activeChanged(): void;
}

export interface Attract {
  /** Whether attract mode is on: a demo playing, or the pause before the next. */
  readonly active: boolean;
  /** The demo playing or just played; null while attract mode is off. */
  readonly demo: AttractDemo | null;
  /** Demo frames drawn since attract mode last turned on. */
  readonly frames: number;
  /** Whether a demo threw, which keeps attract mode off until the page loads again. */
  readonly halted: boolean;
  /** One display frame: counts the idle time, or plays and draws the demo. True when it drew a demo frame. */
  frame(frameSeconds: number): boolean;
  /** An input, or the tab going to the background: restarts the idle count and ends a demo. True if it ended one, so the input must do nothing else. */
  interrupt(): boolean;
  resize(field: Field): void;
  /**
   * Counts the idle stretch as over, so the next frame on the bare title starts a demo, as ATTRACT_IDLE_SECONDS of idling
   * would. Only tests and the e2e attract-now hook call it; a release build carries it uncalled, as dropping it there
   * would take a build-mode branch here or a test seam in the deps.
   */
  dueNow(): void;
  /** Stops attract mode for the session, as the game stopping after a crash does: a demo playing ends, and none starts. */
  stop(): void;
}

/** One demo's World and the expert flying it. */
class DemoRun {
  private readonly bot: Bot;
  private readonly view: BotView;
  /** Whether the demo has finished playing: its galaxy ended, or DEMO_SECONDS passed. */
  over = false;

  constructor(
    readonly demo: AttractDemo,
    readonly world: World,
    private readonly renderer: AttractDeps['renderer'],
  ) {
    this.bot = createExpert(botRng(demo.seed));
    this.view = createView(world);
  }

  /** One sim step with the bot's controls; the renderer gets its events. */
  readonly step = (dt: number): void => {
    const { world } = this;
    const events = world.step(dt, this.bot.decide(readView(world, this.view)));
    this.renderer.handle(events, world);
  };
}

/**
 * Plays the expert bot through the demo galaxies behind the title once the title has sat idle. It never touches the
 * save, the screen flow, the pickup notices or the audio: the demo World is free play, and only the renderer sees it.
 * Whatever throws in a frame or an interrupt, the demo or the tidying up after it, stops attract mode for the session.
 */
export function createAttract(deps: AttractDeps): Attract {
  const { renderer } = deps;
  const loop = createFixedStepLoop();
  const state: { -readonly [K in keyof IdleState]: IdleState[K] } = { screen: 'title', covered: false, visible: true, reducedMotion: false, portrait: false, idleSeconds: 0 };
  let active = false;
  let halted = false;
  let run: DemoRun | null = null;
  let next = 0;
  let gapLeft = 0;
  let frames = 0;
  /** The palette in force before the demos, put back when they stop. */
  let paletteBefore: PaletteId = renderer.palette;

  function readState(): Readonly<IdleState> {
    state.screen = deps.screen();
    state.covered = deps.covered();
    state.visible = deps.visible();
    state.reducedMotion = deps.reducedMotion();
    state.portrait = deps.portrait();
    return state;
  }

  /** The next demo's World, in its galaxy's palette; null while the page has no size yet. */
  function startDemo(): DemoRun | null {
    const field = deps.field();
    if (field === null) return null;
    const demo = ATTRACT_DEMOS[next % ATTRACT_DEMOS.length];
    if (demo === undefined) return null;
    next++;
    const galaxy = galaxyById(demo.galaxy);
    const world = new World({ seed: demo.seed, field, rules: { kind: 'galaxy', galaxy, mode: 'free' } });
    renderer.reset();
    renderer.setPalette(galaxy.palette);
    loop.reset();
    deps.demoStarted();
    return new DemoRun(demo, world, renderer);
  }

  function turnOn(): void {
    active = true;
    frames = 0;
    paletteBefore = renderer.palette;
    deps.activeChanged();
  }

  function turnOff(): void {
    if (!active) return;
    active = false;
    run?.world.endRun();
    run = null;
    gapLeft = 0;
    renderer.reset();
    renderer.setPalette(paletteBefore);
    deps.activeChanged();
  }

  /** Steps the demo for `dt`, or holds it still through the pause after it, then draws it without the HUD. */
  function playFrame(dt: number): boolean {
    if (run?.over === true) {
      gapLeft -= dt;
      if (gapLeft <= 0) run = null;
    }
    run ??= startDemo();
    if (run === null) return false;
    const { world } = run;
    if (run.over) renderer.settle(dt, world);
    else {
      loop.advance(dt, run.step);
      renderer.advance(dt, world, false);
      if (hasEnded(world.status) || world.elapsed >= DEMO_SECONDS - 1e-9) {
        run.over = true;
        gapLeft = DEMO_GAP_SECONDS;
      }
    }
    renderer.draw(world, run.over ? 1 : loop.alpha(), null);
    frames++;
    return true;
  }

  /** One display frame of `dt`: counts the idle time, or turns attract mode on or off and plays the demo. */
  function tick(dt: number): boolean {
    const now = readState();
    if (!attractAllowed(now)) {
      state.idleSeconds = 0;
      turnOff();
      return false;
    }
    if (!active) {
      state.idleSeconds += dt;
      if (!attractDue(now)) return false;
      turnOn();
    }
    return playFrame(dt);
  }

  /** Runs `body`; a throw stops attract mode for the session, writing the log, and gives `fallback`. */
  function guarded<T>(body: () => T, fallback: T): T {
    try {
      return body();
    } catch (error) {
      halt(error);
      return fallback;
    }
  }

  /** Stops attract mode for the session, never throwing: a failure to tidy the demo away is logged instead. */
  function stopForSession(): void {
    halted = true;
    try {
      turnOff();
    } catch (failure) {
      active = false;
      run = null;
      deps.log.add('error', `The attract demo could not tidy up as it stopped: ${describeError(failure)}`, deps.now());
    }
  }

  /** A demo that throws stops attract mode for the session, and the log says why; the title is never blocked. */
  function halt(error: unknown): void {
    deps.log.add('error', `The attract demo stopped after an error and stays off until the page loads again: ${describeError(error)}`, deps.now());
    stopForSession();
  }

  return {
    get active() {
      return active;
    },
    get demo() {
      return run?.demo ?? null;
    },
    get frames() {
      return frames;
    },
    get halted() {
      return halted;
    },
    frame(frameSeconds) {
      return !halted && guarded(() => tick(visualFrameSeconds(frameSeconds)), false);
    },
    interrupt() {
      state.idleSeconds = 0;
      const ended = active;
      guarded(turnOff, undefined);
      return ended;
    },
    resize(field) {
      run?.world.resize(field);
    },
    dueNow() {
      state.idleSeconds = ATTRACT_IDLE_SECONDS;
    },
    stop: stopForSession,
  };
}
