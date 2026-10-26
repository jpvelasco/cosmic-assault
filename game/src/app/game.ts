import { createAudioEngine, type AudioState, type MusicLevel } from '../audio/engine';
import { currentBuildLabel } from '../buildLabel';
import { controlsFromKeys } from '../input/keyboard';
import { createKeyLatch } from '../input/keyLatch';
import { attachKeyboard } from '../input/keyboardSource';
import { attachTouchControls } from '../input/touchControls';
import { createCrashGuard } from '../platform/crashGuard';
import { attachFullscreenKey, createFullscreen } from '../platform/fullscreen';
import { RingLog } from '../platform/log';
import type { CornerBox, HudRect } from '../render/hud';
import { LITE_FROM_INDEX, QualityScaler, type QualityLevel } from '../render/quality';
import { createRenderer } from '../render/renderer';
import type { VisualScale } from '../render/visualScale';
import { PLAYER } from '../sim/config';
import type { Controls } from '../sim/controls';
import { fieldForViewport, type Field } from '../sim/field';
import { createFixedStepLoop } from '../sim/loop';
import { MIN_PRACTICE_LEVEL, World } from '../sim/world';
import { createCrashCard } from '../ui/crashCard';
import { TOUCH_STYLE_QUERY } from '../ui/hints';
import { createOverlay } from '../ui/overlay';
import { createRotatePrompt } from '../ui/rotatePrompt';
import { createSettingsCard } from '../ui/settingsCard';
import { createSafeAreaProbe } from '../ui/safeArea';
import { createToast } from '../ui/toast';
import { commandForKey, START, TO_TITLE, TOGGLE_FULLSCREEN, type Command } from './commands';
import { passesGameOverGuard } from './gameOverGuard';
import { FrameMonitor, type FrameSummary } from './frameMonitor';
import { HitStop } from './hitStop';
import { clockSeed, runOverrides } from './seed';
import { browserStorage, loadSettings, saveSettings, shakeEnabled, type Settings } from './settings';

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
const TOAST_MUTED = 'Muted';
const TOAST_SOUND_ON = 'Sound on';

/** How long the pointer must rest during play before the cursor is hidden. */
const IDLE_CURSOR_MS = 2000;

/** Caps the visual step after a stalled frame, so stars and particles never jump. */
const MAX_VISUAL_STEP_SECONDS = 0.1;

function listen(target: EventTarget, type: string, listener: (e: Event) => void): () => void {
  target.addEventListener(type, listener);
  return () => {
    target.removeEventListener(type, listener);
  };
}

export function createApp(root: HTMLElement, canvas: HTMLCanvasElement, e2e?: E2eHooks): App {
  const renderer = createRenderer(canvas);
  const keyboard = attachKeyboard(window);
  const startKeys = createKeyLatch();
  const touch = attachTouchControls(root, pauseByPlayer);
  const safeArea = createSafeAreaProbe(root);
  const loop = createFixedStepLoop();
  const hitStop = new HitStop();
  const scaler = new QualityScaler();
  const log = new RingLog();
  const monitor = new FrameMonitor((frameMs) => {
    // A hidden tab's frames are not stalls: the browser simply stopped drawing.
    if (document.visibilityState === 'visible') log.add('stall', `${String(Math.round(frameMs))} ms frame`, performance.now());
  });
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const touchStyle = window.matchMedia(TOUCH_STYLE_QUERY);
  const portrait = window.matchMedia('(orientation: portrait)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storage = browserStorage();
  let settings = loadSettings(storage);
  const audio = createAudioEngine(settings);
  const toast = createToast(root);
  const fullscreen = createFullscreen(document, document.documentElement, log);
  const overrides = runOverrides();
  if (overrides.quality !== undefined) scaler.pin(overrides.quality);
  const button = (command: Command) => (): void => {
    applyCommand(command, performance.now());
  };
  const overlay = createOverlay(root, {
    start: button(START),
    selectLevel,
    resume,
    quit,
    toTitle: button(TO_TITLE),
    toggleMute,
    toggleFullscreen: button(TOGGLE_FULLSCREEN),
    openSettings,
  });
  const settingsCard = createSettingsCard(root, {
    change: applySettings,
    save: persistSettings,
    toggleMute,
    previewSfx: () => {
      audio.play('uiClick');
    },
    done: closeSettings,
  });

  const rotatePrompt = createRotatePrompt(root);
  const crashCard = createCrashCard(root, {
    report: () => log.report({ build: currentBuildLabel(), userAgent: navigator.userAgent, mode }),
    toast,
  });
  const guard = createCrashGuard(log, stopAfterCrash);

  let mode: AppMode = 'title';
  let world: World | null = null;
  let practiceLevel = MIN_PRACTICE_LEVEL;
  let field: Field | null = null;
  let resizePending = true;
  /** Outside play the frame only changes on a mode change or resize, so it is redrawn only then. */
  let redrawPending = false;
  /** Whether the settings card is over the title or pause card; the run behind it, if any, stays as it was. */
  let settingsOpen = false;
  /** The save warning is given once: a slider that is dragged again and again must not flood the console. */
  let warnedStorage = false;
  let gameOverAt = 0;
  let lastFrameAt = performance.now();
  let frameId = 0;
  /** The touch pause button's corner, kept while the button is hidden: it is anchored top-right, so it holds across resizes. */
  let pauseCorner: CornerBox | null = null;
  let idleCursorTimer: number | undefined;

  /** Hands the scaler's level to the renderer and the page (`lite` marks the levels where CSS should drop backdrop blur). */
  function applyQuality(): void {
    renderer.setQuality(scaler.level);
    document.body.classList.toggle('lite', scaler.index >= LITE_FROM_INDEX);
  }

  function syncView(): void {
    // After a crash the recovery card owns the screen; a late event must not bring the touch layer or a card back over it.
    if (guard.tripped) return;
    const rotating = needsRotation();
    overlay.update({
      mode,
      practiceLevel,
      score: world?.score ?? 0,
      muted: audio.muted,
      fullscreen: fullscreen.supported ? fullscreen.active : null,
      covered: settingsOpen || rotating,
      inputStyle: touchStyle.matches ? 'touch' : 'keys',
    });
    settingsCard.update(settings, coarsePointer.matches);
    settingsCard.cover(rotating);
    rotatePrompt.show(rotating);
    touch.show(mode === 'playing' && coarsePointer.matches);
    syncHudBounds();
  }

  /** A phone held upright: the game needs the wide screen, so it asks for a turn instead of playing. */
  function needsRotation(): boolean {
    return touchStyle.matches && portrait.matches;
  }

  /** A screen or pointer change: a run that is playing when the phone turns upright pauses, and stays paused when it turns back. */
  function onPlatformChange(): void {
    if (needsRotation()) pause();
    syncView();
  }

  /** Hides the cursor after it rests for `IDLE_CURSOR_MS` in play; any move, and leaving play or a crash, brings it back. */
  function armIdleCursor(): void {
    clearTimeout(idleCursorTimer);
    idleCursorTimer = undefined;
    document.body.classList.remove('cursor-idle');
    if (mode !== 'playing' || guard.tripped) return;
    idleCursorTimer = window.setTimeout(() => {
      document.body.classList.add('cursor-idle');
    }, IDLE_CURSOR_MS);
  }

  /** Keeps the HUD inside the safe area and, on touch screens, clear of the pause button (CA-024). */
  function syncHudBounds(): void {
    if (!coarsePointer.matches) pauseCorner = null;
    else {
      const button = touch.pauseRect();
      if (button !== null) pauseCorner = { width: root.clientWidth - button.left, height: button.bottom };
    }
    renderer.setHudBounds({ insets: safeArea.read(), topRight: pauseCorner });
  }

  function setMode(next: AppMode): void {
    // After a crash the log and the report's mode stay as they were when the game stopped.
    if (guard.tripped) return;
    mode = next;
    log.add('mode', next, performance.now());
    audio.setMusicLevel(MUSIC_LEVEL[next]);
    redrawPending = true;
    armIdleCursor();
    syncView();
  }

  /** Applies the latest viewport size once per frame; the renderer re-bakes its sky on each resize. */
  function applyPendingResize(): void {
    const { clientWidth, clientHeight } = root;
    if (!resizePending || clientWidth === 0 || clientHeight === 0) return;
    resizePending = false;
    field = fieldForViewport(clientWidth, clientHeight);
    renderer.resize(clientWidth, clientHeight, field);
    syncHudBounds();
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
    syncView();
  }

  /** Writes the current settings to storage. A refusal is a warning, not an error: the changes still hold for this visit. */
  function persistSettings(): void {
    if (!saveSettings(storage, settings) && !warnedStorage) {
      warnedStorage = true;
      console.warn('Could not save your settings, so they will reset on reload. Allow site storage for this page to keep them.');
    }
  }

  /** Puts the settings into effect: volumes, the shake gate and the touch layout. Saving is separate (`persistSettings`). */
  function applySettings(patch: Partial<Settings>): void {
    settings = { ...settings, ...patch };
    audio.setVolumes(settings.musicVolume, settings.sfxVolume);
    syncMotion();
    touch.setLeftHanded(settings.leftHanded);
  }

  /** The M key and the sound chip. */
  function toggleMute(): void {
    audio.setMuted(!audio.muted);
    toast.show(audio.muted ? TOAST_MUTED : TOAST_SOUND_ON);
    settings = { ...settings, muted: audio.muted };
    syncView();
    persistSettings();
  }

  function openSettings(): void {
    if (settingsOpen || (mode !== 'title' && mode !== 'paused')) return;
    settingsOpen = true;
    syncView();
    settingsCard.show();
  }

  /** Done and Esc: back to the card that opened it, with focus on the chip that did. */
  function closeSettings(): void {
    if (!settingsOpen) return;
    settingsOpen = false;
    settingsCard.hide();
    syncView();
    overlay.focusSettingsChip();
  }

  /** Runs a key or button command unless the game-over guard is still ignoring it. */
  function applyCommand(command: Command, now: number): void {
    if (!passesGameOverGuard(mode, command, now - gameOverAt)) return;
    // Behind the rotate prompt nothing starts or resumes; a pause still takes effect.
    if (needsRotation() && (command.kind === 'start' || (command.kind === 'togglePause' && mode !== 'playing'))) return;
    switch (command.kind) {
      case 'start':
        start();
        break;
      case 'toTitle':
        quit();
        break;
      case 'selectLevel':
        selectLevel(command.level);
        break;
      case 'togglePause':
        if (mode === 'playing') pauseByPlayer();
        else resume();
        break;
      case 'toggleMute':
        toggleMute();
        break;
      case 'toggleFullscreen':
        fullscreen.toggle();
        break;
    }
  }

  function readControls(): Controls {
    const keys = controlsFromKeys(startKeys.active(keyboard.held));
    return { ...keys, fire: keys.fire || touch.fire, stick: touch.stick };
  }

  function stepWorld(run: World, frameSeconds: number, now: number): void {
    const controls = readControls();
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
    settingsCard.hide();
    rotatePrompt.show(false);
    armIdleCursor();
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
    for (const code of keyboard.drainPressed()) {
      startKeys.release(code);
      const command = commandForKey(mode, code);
      // Behind the settings card only M acts: Space, P and Esc must not start, resume or leave.
      if (command !== null && (!settingsOpen || command.kind === 'toggleMute')) applyCommand(command, now);
    }
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
      stepWorld(world, frameSeconds, now);
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

  /** The one motion source: reduced motion turns off hit-stop, flash and shake; the shake setting can also turn off shake alone. */
  function syncMotion(): void {
    hitStop.reducedMotion = reducedMotion.matches;
    renderer.effects.reducedMotion = reducedMotion.matches;
    renderer.effects.shakeEnabled = shakeEnabled(settings.screenShake, reducedMotion.matches);
  }
  applySettings({});
  applyQuality();
  const markResize = (): void => {
    resizePending = true;
  };
  /** Full screen changes the viewport and the chip's label. */
  const onFullscreenChange = (): void => {
    markResize();
    syncView();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') pause();
  };

  const unlisteners = [
    listen(window, 'resize', markResize),
    listen(window, 'orientationchange', markResize),
    listen(reducedMotion, 'change', syncMotion),
    listen(touchStyle, 'change', onPlatformChange),
    listen(coarsePointer, 'change', onPlatformChange),
    listen(portrait, 'change', onPlatformChange),
    listen(window, 'pointermove', armIdleCursor),
    listen(window, 'blur', pause),
    listen(document, 'visibilitychange', onVisibilityChange),
    fullscreen.onChange(onFullscreenChange),
    attachFullscreenKey(window, fullscreen),
    guard.attachGlobal(window),
  ];
  syncView();
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
      return settings;
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
      overlay.dispose();
      settingsCard.dispose();
      rotatePrompt.dispose();
      toast.dispose();
      crashCard.dispose();
      audio.dispose();
      safeArea.dispose();
      renderer.dispose();
      clearTimeout(idleCursorTimer);
      document.body.classList.remove('lite', 'cursor-idle');
    },
  };
}
