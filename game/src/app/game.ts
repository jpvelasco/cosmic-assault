import { controlsFromKeys } from '../input/keyboard';
import { createKeyLatch } from '../input/keyLatch';
import { attachKeyboard } from '../input/keyboardSource';
import { attachTouchControls } from '../input/touchControls';
import type { CornerBox, HudRect } from '../render/hud';
import { createRenderer } from '../render/renderer';
import { PLAYER } from '../sim/config';
import type { Controls } from '../sim/controls';
import { fieldForViewport, type Field } from '../sim/field';
import { createFixedStepLoop } from '../sim/loop';
import { MIN_PRACTICE_LEVEL, World } from '../sim/world';
import { createOverlay } from '../ui/overlay';
import { createSafeAreaProbe } from '../ui/safeArea';
import { commandForKey, START, TO_TITLE, type Command } from './commands';
import { passesGameOverGuard } from './gameOverGuard';
import { HitStop } from './hitStop';
import { clockSeed, runOverrides } from './seed';

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
  /** Starts a run from the title or game-over screen; ignored in other modes. */
  start(): void;
  pause(): void;
  resume(): void;
  /** Ends the run and returns to the title screen. */
  quit(): void;
  dispose(): void;
}

/** Caps the visual step after a stalled frame, so stars and particles never jump. */
const MAX_VISUAL_STEP_SECONDS = 0.1;

function listen(target: EventTarget, type: string, listener: (e: Event) => void): () => void {
  target.addEventListener(type, listener);
  return () => {
    target.removeEventListener(type, listener);
  };
}

export function createApp(root: HTMLElement, canvas: HTMLCanvasElement): App {
  const renderer = createRenderer(canvas);
  const keyboard = attachKeyboard(window);
  const startKeys = createKeyLatch();
  const touch = attachTouchControls(root, pause);
  const safeArea = createSafeAreaProbe(root);
  const loop = createFixedStepLoop();
  const hitStop = new HitStop();
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const overrides = runOverrides();
  const button = (command: Command) => (): void => {
    applyCommand(command, performance.now());
  };
  const overlay = createOverlay(root, { start: button(START), selectLevel, resume, quit, toTitle: button(TO_TITLE) });

  let mode: AppMode = 'title';
  let world: World | null = null;
  let practiceLevel = MIN_PRACTICE_LEVEL;
  let field: Field | null = null;
  let resizePending = true;
  /** Outside play the frame only changes on a mode change or resize, so it is redrawn only then. */
  let redrawPending = false;
  let gameOverAt = 0;
  let lastFrameAt = performance.now();
  let frameId = 0;
  /** The touch pause button's corner, kept while the button is hidden: it is anchored top-right, so it holds across resizes. */
  let pauseCorner: CornerBox | null = null;

  function syncView(): void {
    overlay.update({ mode, practiceLevel, score: world?.score ?? 0 });
    touch.show(mode === 'playing' && coarsePointer.matches);
    syncHudBounds();
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
    mode = next;
    redrawPending = true;
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
    setMode('playing');
  }

  function pause(): void {
    if (mode !== 'playing') return;
    hitStop.clear();
    setMode('paused');
  }

  function resume(): void {
    if (mode !== 'paused') return;
    loop.reset();
    setMode('playing');
  }

  function quit(): void {
    if (world === null) return;
    world.endRun();
    world = null;
    hitStop.clear();
    setMode('title');
  }

  function selectLevel(level: number): void {
    if (mode !== 'title') return;
    practiceLevel = level;
    syncView();
  }

  /** Runs a key or button command unless the game-over guard is still ignoring it. */
  function applyCommand(command: Command, now: number): void {
    if (!passesGameOverGuard(mode, command, now - gameOverAt)) return;
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
        if (mode === 'playing') pause();
        else resume();
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
    });
    if (run.status === 'gameOver') {
      gameOverAt = now;
      setMode('gameOver');
    }
  }

  function frame(): void {
    frameId = requestAnimationFrame(frame);
    const now = performance.now();
    const frameSeconds = (now - lastFrameAt) / 1000;
    lastFrameAt = now;
    applyPendingResize();
    for (const code of keyboard.drainPressed()) {
      startKeys.release(code);
      const command = commandForKey(mode, code);
      if (command !== null) applyCommand(command, now);
    }
    // A re-bake that lands after a resize repaints a still frame (paused, game over) with it.
    if (renderer.consumeRedrawRequest()) redrawPending = true;
    if (world === null) return;
    // Visuals run on real frame time rather than sim time, so they keep moving through a hit-stop freeze.
    const visualSeconds = Math.min(Math.max(frameSeconds, 0), MAX_VISUAL_STEP_SECONDS);
    if (mode === 'playing') {
      const frozen = hitStop.frozen;
      stepWorld(world, frameSeconds, now);
      renderer.advance(visualSeconds, world, frozen);
    } else if (mode === 'gameOver' && renderer.hasActiveParticles()) {
      // The death burst plays out under the card; redrawing stops once the last particle is gone.
      renderer.settle(visualSeconds, world);
      redrawPending = true;
    }
    if (mode === 'playing' || redrawPending) {
      renderer.draw(world, loop.alpha());
      redrawPending = false;
    }
  }

  /** The one reduced-motion source: it turns off hit-stop, shake and flash together. */
  const syncReducedMotion = (): void => {
    hitStop.reducedMotion = reducedMotion.matches;
    renderer.effects.reducedMotion = reducedMotion.matches;
  };
  syncReducedMotion();
  const markResize = (): void => {
    resizePending = true;
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') pause();
  };

  const unlisteners = [
    listen(window, 'resize', markResize),
    listen(window, 'orientationchange', markResize),
    listen(reducedMotion, 'change', syncReducedMotion),
    listen(window, 'blur', pause),
    listen(document, 'visibilitychange', onVisibilityChange),
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
      safeArea.dispose();
      renderer.dispose();
    },
  };
}
