import { createAudioEngine, needsSoundGesture, type AudioState } from '../audio/engine';
import type { ThemeId } from '../audio/themes';
import { currentBuildLabel } from '../buildLabel';
import type { GalaxyDef, PaletteId } from '../content/types';
import { controlsFromPad, createPadFireLatch, createPadReader, padEdges, type PadEdge, type PadSnapshot } from '../input/gamepad';
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
import { paletteFor } from '../render/palette';
import { createRenderer } from '../render/renderer';
import type { VisualScale } from '../render/visualScale';
import { NO_CONTROLS, type Controls } from '../sim/controls';
import { fieldForViewport, type Field } from '../sim/field';
import { createFixedStepLoop } from '../sim/loop';
import { applyAccents } from '../ui/accents';
import { createCrashCard } from '../ui/crashCard';
import { listen } from '../ui/dom';
import { SOUND_GESTURE_HINT } from '../ui/hints';
import { createOverlay } from '../ui/overlay';
import { createRotatePrompt } from '../ui/rotatePrompt';
import { createToast } from '../ui/toast';
import type { CardToggleDeps } from './cardToggle';
import { TOGGLE_FULLSCREEN, type Command } from './commands';
import { installE2eHooks, type E2eHooks } from './e2eHooks';
import { END_SCREENS, MENU_SCREENS, type Screen } from './flow';
import { FrameMonitor, type FrameSummary } from './frameMonitor';
import { HitStop } from './hitStop';
import { coversFor, createInputRouter, type Cover } from './inputRouting';
import { createRunController, type RunController } from './runController';
import { runOverrides } from './seed';
import { browserStorage, loadSettings, type Settings } from './settings';
import { createSettingsController } from './settingsController';
import { createViewSync } from './viewSync';
import { createRecords } from './records';

export interface App {
  /** The screen shown. */
  readonly mode: Screen;
  /** The run: its World (null on the menu screens), the screen flow, the save in memory and the run total. */
  readonly run: Pick<RunController, 'world' | 'flow' | 'save' | 'runTotal'>;
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
  /** The colour look in force: the last run's galaxy's palette, the Drift's before any run. */
  readonly palette: PaletteId;
  /** The music theme chosen: a galaxy's, its boss variant once the boss appears, and the last Dimension's on a menu. */
  readonly musicTheme: ThemeId;
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
  pause(): void;
  resume(): void;
  /** Ends the paused run and returns to the title screen. */
  quit(): void;
  dispose(): void;
}

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
  const run = createRunController({
    storage,
    overrides,
    log,
    field: () => {
      applyPendingResize();
      return field;
    },
    showScreen: setMode,
    onRunStarted,
    notify: toast.show,
    onEvents: (events, world) => {
      hitStop.trigger(events);
      renderer.handle(events, world);
      audio.handle(events);
      overlay.handle(events);
      if (import.meta.env.MODE === 'e2e') e2e?.e2eEvents?.(events, world);
    },
    refresh: syncView,
  });

  let mode: Screen = 'title';
  let field: Field | null = null;
  let resizePending = true;
  /** Outside play the frame only changes on a screen change or resize, so it is redrawn only then. */
  let redrawPending = false;
  /** When the run on the end card ended; the card's guard counts from it. */
  let runEndedAt = 0;
  /** The pad as of the last frame, kept as plain arrays so a browser that reuses its Gamepad object cannot alter it. */
  let previousPad: PadSnapshot | null = null;
  const padFire = createPadFireLatch();
  let lastFrameAt = performance.now();
  let frameId = 0;
  /** The sound hint is given once a visit: a pad-only player needs it once, and a toast on every A would nag. */
  let soundHintGiven = false;
  const applyNow = (command: Command): void => {
    router.applyCommand(command, performance.now());
  };
  const overlay = createOverlay(root, {
    command: applyNow,
    resume,
    quit,
    toggleMute: () => {
      prefs.toggleMute();
    },
    toggleFullscreen: () => {
      applyNow(TOGGLE_FULLSCREEN);
    },
    openSettings: () => {
      prefs.openSettings();
    },
    openRecords: () => {
      records.show();
    },
    install: installPrompt.install,
  });
  // After the overlay, so the settings card is drawn over the title and pause cards it opens from.
  const prefs = createSettingsController(root, {
    storage,
    initial: saved,
    audio,
    toast,
    touch,
    hitStop,
    effects: renderer.effects,
    ...coverCardDeps('settings'),
  });
  const records = createRecords(root, coverCardDeps('records'));
  const rotatePrompt = createRotatePrompt(root);
  const crashCard = createCrashCard(root, {
    report: () => log.report({ build: currentBuildLabel(), userAgent: navigator.userAgent, mode }),
    toast,
  });
  const guard = createCrashGuard(log, stopAfterCrash);
  const view = createViewSync(root, {
    overlay,
    settingsCard: prefs.card,
    records,
    rotatePrompt,
    touch,
    renderer,
    read: () => ({
      flow: run.flow,
      save: run.save,
      rankLock: run.rankLock,
      score: run.world?.score ?? 0,
      muted: audio.muted,
      fullscreen: fullscreen.supported ? fullscreen.active : null,
      installOffer: installPrompt.offer,
      settings: prefs.settings,
      settingsOpen: prefs.open,
    }),
    screen: () => mode,
    tripped: () => guard.tripped,
    onTurnUpright: pause,
  });
  const router = createInputRouter(window, {
    keyboard,
    startKeys,
    run: {
      flow: run.command,
      pause: pauseByPlayer,
      resume,
      toggleMute: prefs.toggleMute,
      toggleFullscreen: () => {
        fullscreen.toggle();
      },
    },
    screen: () => mode,
    covers,
    msSinceRunEnd: (now) => now - runEndedAt,
    menuControls: () => (prefs.open ? prefs.card.controls() : records.open ? records.card.controls() : overlay.controls(mode)),
    closeCard: () => {
      prefs.closeSettings();
      records.close();
    },
  });

  /** What the settings or records card needs to open and close over the screens, its focus going back to its chip. */
  function coverCardDeps(chip: 'settings' | 'records'): Omit<CardToggleDeps, 'opensOn'> {
    const focusOpener = (): void => {
      overlay.focusChip(chip);
    };
    return { screen: () => mode, covers, syncView, focusOpener };
  }

  /** What covers the cards right now, for the router's table. */
  function covers(): Cover[] {
    return coversFor({ settings: prefs.open, records: records.open, rotate: view.needsRotation(), crash: guard.tripped });
  }

  function syncView(): void {
    view.sync();
  }

  /** Hands the scaler's level to the renderer and the page (`lite` marks the levels where CSS should drop backdrop blur). */
  function applyQuality(): void {
    renderer.setQuality(scaler.level);
    document.body.classList.toggle('lite', scaler.index >= LITE_FROM_INDEX);
  }

  function setMode(next: Screen): void {
    // After a crash the log and the report's mode stay as they were when the game stopped.
    if (guard.tripped) return;
    mode = next;
    const now = performance.now();
    log.add('mode', next, now);
    if (END_SCREENS.includes(next)) runEndedAt = now;
    if (MENU_SCREENS.includes(next)) hitStop.clear();
    audio.setScreen(next);
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
    run.world?.resize(field);
    redrawPending = true;
  }

  /** A new World is in place for `galaxy`: fresh input latches, loop, renderer (in the galaxy's palette) and frame stats for it. */
  function onRunStarted(galaxy: GalaxyDef): void {
    startKeys.latch(keyboard.held);
    padFire.latch(previousPad);
    loop.reset();
    hitStop.clear();
    renderer.setPalette(galaxy.palette);
    applyAccents(document.documentElement.style, paletteFor(galaxy.palette));
    renderer.reset();
    monitor.reset();
    scaler.startRun();
    audio.play('uiClick');
  }

  /** Pauses a run in play; returns whether it did. */
  function pause(): boolean {
    if (mode !== 'playing') return false;
    hitStop.clear();
    run.pause();
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
    run.resume();
  }

  function quit(): void {
    if (mode !== 'paused') return;
    audio.play('uiClick');
    run.quit();
  }

  /** Pads grant no user activation, so the first A while sound waits for one says how to turn it on. */
  function hintSoundGesture(edges: readonly PadEdge[]): void {
    if (soundHintGiven || !edges.includes('confirm') || !needsSoundGesture(audio.state, audio.muted)) return;
    soundHintGiven = true;
    toast.show(SOUND_GESTURE_HINT);
  }

  function readControls(pad: PadSnapshot | null): Controls {
    const keys = controlsFromKeys(startKeys.active(keyboard.held));
    return mergeControls(keys, touch, padFire.apply(controlsFromPad(pad)));
  }

  /** Steps the run; a clear or game over moves the flow to its end card, after which the steps do nothing. */
  function stepRun(controls: Controls, frameSeconds: number): void {
    // A freeze triggered by a step in this frame takes effect from the next frame's consume().
    loop.advance(hitStop.consume(frameSeconds), (dt) => {
      run.step(dt, controls);
    });
  }

  /** Stops the game for good and shows the recovery card. Silences audio without touching the saved sound setting. */
  function stopAfterCrash(error: unknown): void {
    cancelAnimationFrame(frameId);
    // A crashed tab can no longer play its Rank galaxy, so it stops answering for it.
    run.dispose();
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
    hintSoundGesture(edges);
    router.routeKeys(now);
    // A re-bake that lands after a resize repaints a still frame (paused, game over) with it.
    if (renderer.consumeRedrawRequest()) redrawPending = true;
    const settling = END_SCREENS.includes(mode) && renderer.hasActiveParticles();
    // Still screens cost next to nothing, so their frame interval is the display's own rate.
    if (mode !== 'playing' && !settling) scaler.sampleIdle(frameMs);
    const { world } = run;
    if (world === null) return;
    // Visuals run on real frame time rather than sim time, so they keep moving through a hit-stop freeze.
    const visualSeconds = Math.min(Math.max(frameSeconds, 0), MAX_VISUAL_STEP_SECONDS);
    if (mode === 'playing') {
      monitor.sample(frameMs);
      const levelBefore = scaler.index;
      scaler.sample(frameMs);
      if (scaler.index !== levelBefore) applyQuality();
      const frozen = hitStop.frozen;
      stepRun(readControls(pad), frameSeconds);
      renderer.advance(visualSeconds, world, frozen);
    } else if (run.warpingUnderCard) {
      // The clear is recorded and its card shown as the warp starts; the warp plays out under the card, untouched by input.
      stepRun(NO_CONTROLS, frameSeconds);
      renderer.advance(visualSeconds, world, hitStop.frozen);
      redrawPending = true;
    } else if (settling) {
      // The death or warp burst plays out under the card; redrawing stops once the last particle is gone.
      renderer.settle(visualSeconds, world);
      redrawPending = true;
    }
    if (mode === 'playing' || redrawPending) {
      renderer.draw(world, loop.alpha(), run.runTotal);
      redrawPending = false;
    }
  }

  installE2eHooks(e2e, {
    run,
    mode: () => mode,
    controls: () => readControls(previousPad),
    redraw: () => {
      redrawPending = true;
    },
  });

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
    run,
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
    get palette() {
      return renderer.palette;
    },
    get musicTheme() {
      return audio.theme;
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
      records.card.dispose();
      rotatePrompt.dispose();
      toast.dispose();
      crashCard.dispose();
      audio.dispose();
      run.dispose();
      renderer.dispose();
      document.body.classList.remove('lite');
    },
  };
}
