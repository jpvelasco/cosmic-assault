import { createAudioEngine, type AudioState, type MusicLevel } from '../audio/engine';
import { currentBuildLabel } from '../buildLabel';
import { controlsFromPad, createPadFireLatch, createPadReader, padEdges, type PadSnapshot } from '../input/gamepad';
import { controlsFromKeys } from '../input/keyboard';
import { createKeyLatch } from '../input/keyLatch';
import { attachKeyboard } from '../input/keyboardSource';
import { mergeControls } from '../input/mergeControls';
import { attachTouchControls } from '../input/touchControls';
import { createCrashGuard } from '../platform/crashGuard';
import { createFullscreen } from '../platform/fullscreen';
import { createInstallPrompt } from '../platform/install';
import { RingLog } from '../platform/log';
import type { HudRect } from '../render/hud';
import { LITE_FROM_INDEX, QualityScaler, type QualityLevel } from '../render/quality';
import { createRenderer } from '../render/renderer';
import type { VisualScale } from '../render/visualScale';
import { PLAYER } from '../sim/config';
import type { Controls } from '../sim/controls';
import { fieldForViewport, type Field } from '../sim/field';
import { createFixedStepLoop } from '../sim/loop';
import { MIN_PRACTICE_LEVEL, World } from '../sim/world';
import { createCrashCard } from '../ui/crashCard';
import { listen } from '../ui/dom';
import { createOverlay } from '../ui/overlay';
import { createRotatePrompt } from '../ui/rotatePrompt';
import { createToast } from '../ui/toast';
import { START, TO_TITLE, TOGGLE_FULLSCREEN, type Command } from './commands';
import { FrameMonitor, type FrameSummary } from './frameMonitor';
import { HitStop } from './hitStop';
import { coversFor, createInputRouter, type Cover } from './inputRouting';
import { clockSeed, runOverrides } from './seed';
import { browserStorage, loadSettings, type Settings } from './settings';
import { createSettingsController } from './settingsController';
import { createViewSync } from './viewSync';

/**
 * Hooks an e2e build hands to `createApp`; `main.ts` passes them only under `import.meta.env.MODE === 'e2e'`, so
 * release builds carry no trace of them. The long property name is deliberate: unlike a local name it survives
 * minification, which lets `check:no-bridge` find it.
 */
export interface E2eHooks {
  /** Runs at the start of every guarded frame. */
  e2eBeforeFrame?: (() => void) | undefined;
}

export type AppMode = 'title' | 'playing' | 'paused' | 'gameOver';

export interface App {
  readonly mode: AppMode;
  /** The current run; null on the title screen. */
  readonly world: World | null;
  /** The level the next run starts at (1–7), chosen on the title screen. */
  readonly practiceLevel: number;
  /** The HUD pills drawn last, in CSS px. */
  readonly hudRects: readonly HudRect[];
  /** Frames drawn so far. */
  readonly drawCount: number;
  /** How much larger than their field size sprites are drawn on this screen. */
  readonly visualScale: VisualScale;
  /** The quality level in force: its index in QUALITY_LEVELS and its settings. */
  readonly quality: { readonly index: number; readonly level: QualityLevel };
  /** Frame times of the current run, less its first 3 s. */
  readonly frameStats: FrameSummary;
  /** Whether sound is muted (saved across visits). */
  readonly muted: boolean;
  /** The settings in force: loaded at start, changed from the settings card, saved when storage allows. */
  readonly settings: Settings;
  /** The motion rules in force once reduced motion and the shake setting are combined. */
  readonly motion: { readonly reducedMotion: boolean; readonly shake: boolean };
  /** 'none' until the first key press or tap creates the audio context. */
  readonly audioState: AudioState;
  /** Whether the page is in full screen; false where the browser cannot. */
  readonly fullscreen: boolean;
  /** What the game has noticed: mode changes, long stalls and errors. Kept in memory only. */
  readonly log: RingLog;
  /** Starts a run from the title or game-over screen; ignored in other modes. */
  start(): void;
  pause(): void;
  resume(): void;
  /** Ends the run and returns to the title screen. */
  quit(): void;
  dispose(): void;
}

const MUSIC_LEVEL: Readonly<Record<AppMode, MusicLevel>> = {
  title: 'menu',
  playing: 'play',
  paused: 'paused',
  gameOver: 'menu',
};

/** Caps the visual step after a stalled frame, so stars and particles never jump. */
const MAX_VISUAL_STEP_SECONDS = 0.1;

export function createApp(root: HTMLElement, canvas: HTMLCanvasElement, e2e?: E2eHooks): App {
  const renderer = createRenderer(canvas);
  const keyboard = attachKeyboard(window);
  const startKeys = createKeyLatch();
  const touch = attachTouchControls(root, pauseByPlayer);
  const log = new RingLog();
  const readPad = createPadReader(
    () => navigator.getGamepads(),
    (error) => {
      log.add('error', 'gamepad unavailable', performance.now());
      console.warn('Gamepad input is unavailable in this browser or frame, so play with the keyboard or touch instead.', error);
    },
  );
  const loop = createFixedStepLoop();
  const hitStop = new HitStop();
  const scaler = new QualityScaler();
  const monitor = new FrameMonitor((frameMs) => {
    // A hidden tab's frames are not stalls: the browser simply stopped drawing.
    if (document.visibilityState === 'visible') log.add('stall', `${String(Math.round(frameMs))} ms frame`, performance.now());
  });
  const storage = browserStorage();
  const saved = loadSettings(storage);
  const audio = createAudioEngine(saved);
  const toast = createToast(root);
  const fullscreen = createFullscreen(document, document.documentElement, log);
  const installPrompt = createInstallPrompt(window, log, syncView);
  const overrides = runOverrides();
  if (overrides.quality !== undefined) scaler.pin(overrides.quality);

  let mode: AppMode = 'title';
  let world: World | null = null;
  let practiceLevel = MIN_PRACTICE_LEVEL;
  let field: Field | null = null;
  let resizePending = true;
  /** Outside play the frame only changes on a mode change or resize, so it is redrawn only then. */
  let redrawPending = false;
  let gameOverAt = 0;
  /** The pad as of the last frame, kept as plain arrays so a browser that reuses its Gamepad object cannot alter it. */
  let previousPad: PadSnapshot | null = null;
  const padFire = createPadFireLatch();
  let lastFrameAt = performance.now();
  let frameId = 0;
  const button = (command: Command) => (): void => {
    router.applyCommand(command, performance.now());
  };
  const overlay = createOverlay(root, {
    start: button(START),
    selectLevel,
    resume,
    quit,
    toTitle: button(TO_TITLE),
    toggleMute,
    toggleFullscreen: button(TOGGLE_FULLSCREEN),
    openSettings: () => {
      prefs.openSettings();
    },
    install: installPrompt.install,
  });
  const prefs = createSettingsController(root, {
    storage,
    initial: saved,
    audio,
    toast,
    touch,
    hitStop,
    effects: renderer.effects,
    mode: () => mode,
    covers,
    syncView,
    focusOpener: () => {
      overlay.focusSettingsChip();
    },
  });
  const rotatePrompt = createRotatePrompt(root);
  const crashCard = createCrashCard(root, {
    report: () => log.report({ build: currentBuildLabel(), userAgent: navigator.userAgent, mode }),
    toast,
  });
  const guard = createCrashGuard(log, stopAfterCrash);
  const view = createViewSync(root, {
    overlay,
    settingsCard: prefs.card,
    rotatePrompt,
    touch,
    renderer,
    read: () => ({
      mode,
      practiceLevel,
      score: world?.score ?? 0,
      muted: audio.muted,
      fullscreen: fullscreen.supported ? fullscreen.active : null,
      installOffer: installPrompt.offer,
      settings: prefs.settings,
      settingsOpen: prefs.open,
    }),
    mode: () => mode,
    tripped: () => guard.tripped,
    onTurnUpright: pause,
  });
  const router = createInputRouter(window, {
    keyboard,
    startKeys,
    run: {
      start,
      quit,
      selectLevel,
      pause: pauseByPlayer,
      resume,
      toggleMute,
      toggleFullscreen: () => {
        fullscreen.toggle();
      },
    },
    mode: () => mode,
    covers,
    msSinceGameOver: (now) => now - gameOverAt,
    menuControls: () => (prefs.open ? prefs.card.controls() : overlay.controls(mode)),
    closeSettings: () => {
      prefs.closeSettings();
    },
  });

  /** What covers the cards right now, for the router's table. */
  function covers(): Cover[] {
    return coversFor({ settings: prefs.open, rotate: view.needsRotation(), crash: guard.tripped });
  }

  function syncView(): void {
    view.sync();
  }

  function toggleMute(): void {
    prefs.toggleMute();
  }

  /** Hands the scaler's level to the renderer and the page (`lite` marks the levels where CSS should drop backdrop blur). */
  function applyQuality(): void {
    renderer.setQuality(scaler.level);
    document.body.classList.toggle('lite', scaler.index >= LITE_FROM_INDEX);
  }

  function setMode(next: AppMode): void {
    // After a crash the log and the report's mode stay as they were when the game stopped.
    if (guard.tripped) return;
    mode = next;
    log.add('mode', next, performance.now());
    audio.setMusicLevel(MUSIC_LEVEL[next]);
    redrawPending = true;
    view.armIdleCursor();
    view.sync();
  }

  /** Applies the latest viewport size once per frame; the renderer re-bakes its sky on each resize. */
  function applyPendingResize(): void {
    const { clientWidth, clientHeight } = root;
    if (!resizePending || clientWidth === 0 || clientHeight === 0) return;
    resizePending = false;
    field = fieldForViewport(clientWidth, clientHeight);
    renderer.resize(clientWidth, clientHeight, field);
    view.syncHudBounds();
    world?.resize(field);
    redrawPending = true;
  }

  function start(): void {
    if (mode !== 'title' && mode !== 'gameOver') return;
    applyPendingResize();
    if (field === null) {
      throw new Error('Cannot start a run: the game root has no size yet; give #app a visible size before starting');
    }
    world = new World({
      seed: overrides.seed ?? clockSeed(),
      field,
      practiceLevel,
      startLives: overrides.startLives ?? PLAYER.startLives,
    });
    startKeys.latch(keyboard.held);
    padFire.latch(previousPad);
    loop.reset();
    hitStop.clear();
    renderer.reset();
    monitor.reset();
    scaler.startRun();
    audio.play('uiClick');
    setMode('playing');
  }

  /** Pauses a run in play; returns whether it did. */
  function pause(): boolean {
    if (mode !== 'playing') return false;
    hitStop.clear();
    setMode('paused');
    return true;
  }

  /** The pause button or key: unlike a blur or hidden tab, it blips. */
  function pauseByPlayer(): void {
    if (pause()) audio.play('pause');
  }

  function resume(): void {
    if (mode !== 'paused') return;
    audio.play('pause');
    loop.reset();
    padFire.latch(previousPad);
    setMode('playing');
  }

  function quit(): void {
    if (world === null) return;
    world.endRun();
    world = null;
    hitStop.clear();
    audio.play('uiClick');
    setMode('title');
  }

  function selectLevel(level: number): void {
    if (mode !== 'title') return;
    practiceLevel = level;
    audio.play('uiClick');
    view.sync();
  }

  function readControls(pad: PadSnapshot | null): Controls {
    const keys = controlsFromKeys(startKeys.active(keyboard.held));
    return mergeControls(keys, touch, padFire.apply(controlsFromPad(pad)));
  }

  function stepWorld(run: World, controls: Controls, frameSeconds: number, now: number): void {
    // A freeze triggered by a step in this frame takes effect from the next frame's consume().
    loop.advance(hitStop.consume(frameSeconds), (dt) => {
      const events = run.step(dt, controls);
      hitStop.trigger(events);
      renderer.handle(events, run);
      audio.handle(events);
    });
    if (run.status === 'gameOver') {
      gameOverAt = now;
      setMode('gameOver');
    }
  }

  /** Stops the game for good and shows the recovery card. Silences audio without touching the saved sound setting. */
  function stopAfterCrash(error: unknown): void {
    cancelAnimationFrame(frameId);
    touch.show(false);
    prefs.card.hide();
    rotatePrompt.show(false);
    view.armIdleCursor();
    crashCard.show();
    audio.setMusicLevel('menu');
    audio.setMuted(true);
    renderer.dispose();
    console.error('Cosmic Assault stopped after an error; use Try again on the card, or Copy report to share what happened.', error);
  }

  function frame(): void {
    frameId = requestAnimationFrame(frame);
    guard.run(guardedFrame);
  }

  function runFrame(): void {
    const now = performance.now();
    const frameMs = now - lastFrameAt;
    const frameSeconds = frameMs / 1000;
    lastFrameAt = now;
    audio.beginFrame();
    applyPendingResize();
    const pad = readPad();
    const edges = padEdges(previousPad, pad);
    previousPad = pad;
    router.routePad(edges, now);
    router.routeKeys(now);
    // A re-bake that lands after a resize repaints a still frame (paused, game over) with it.
    if (renderer.consumeRedrawRequest()) redrawPending = true;
    const settling = mode === 'gameOver' && renderer.hasActiveParticles();
    // Still screens cost next to nothing, so their frame interval is the display's own rate.
    if (mode !== 'playing' && !settling) scaler.sampleIdle(frameMs);
    if (world === null) return;
    // Visuals run on real frame time rather than sim time, so they keep moving through a hit-stop freeze.
    const visualSeconds = Math.min(Math.max(frameSeconds, 0), MAX_VISUAL_STEP_SECONDS);
    if (mode === 'playing') {
      monitor.sample(frameMs);
      const levelBefore = scaler.index;
      scaler.sample(frameMs);
      if (scaler.index !== levelBefore) applyQuality();
      const frozen = hitStop.frozen;
      stepWorld(world, readControls(pad), frameSeconds, now);
      renderer.advance(visualSeconds, world, frozen);
    } else if (settling) {
      // The death burst plays out under the card; redrawing stops once the last particle is gone.
      renderer.settle(visualSeconds, world);
      redrawPending = true;
    }
    if (mode === 'playing' || redrawPending) {
      renderer.draw(world, loop.alpha());
      redrawPending = false;
    }
  }

  /** The frame to run, chosen once: a release build has no hook to look for on each frame. */
  const guardedFrame =
    import.meta.env.MODE === 'e2e' && e2e !== undefined
      ? (): void => {
          e2e.e2eBeforeFrame?.();
          runFrame();
        }
      : runFrame;

  applyQuality();
  const markResize = (): void => {
    resizePending = true;
  };
  /** Full screen changes the viewport and the chip's label. */
  const onFullscreenChange = (): void => {
    markResize();
    view.sync();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') pause();
  };

  const unlisteners = [
    listen(window, 'resize', markResize),
    listen(window, 'orientationchange', markResize),
    listen(window, 'blur', pause),
    listen(document, 'visibilitychange', onVisibilityChange),
    fullscreen.onChange(onFullscreenChange),
    installPrompt.dispose,
    guard.attachGlobal(window),
  ];
  view.sync();
  frameId = requestAnimationFrame(frame);

  return {
    get mode() {
      return mode;
    },
    get world() {
      return world;
    },
    get practiceLevel() {
      return practiceLevel;
    },
    get hudRects() {
      return renderer.hudRects;
    },
    get drawCount() {
      return renderer.drawCount;
    },
    get visualScale() {
      return renderer.visualScale;
    },
    get quality() {
      return { index: scaler.index, level: scaler.level };
    },
    get frameStats() {
      return monitor.summary();
    },
    get muted() {
      return audio.muted;
    },
    get settings() {
      return prefs.settings;
    },
    get motion() {
      return { reducedMotion: renderer.effects.reducedMotion, shake: renderer.effects.shakeEnabled };
    },
    get audioState() {
      return audio.state;
    },
    get fullscreen() {
      return fullscreen.active;
    },
    log,
    start,
    pause,
    resume,
    quit,
    dispose() {
      cancelAnimationFrame(frameId);
      for (const unlisten of unlisteners) unlisten();
      keyboard.dispose();
      touch.dispose();
      router.dispose();
      view.dispose();
      overlay.dispose();
      prefs.dispose();
      rotatePrompt.dispose();
      toast.dispose();
      crashCard.dispose();
      audio.dispose();
      renderer.dispose();
      document.body.classList.remove('lite');
    },
  };
}
