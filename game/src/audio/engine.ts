import type { Screen } from '../app/flow';
import type { Settings } from '../app/settings';
import { galaxyById } from '../content/galaxies';
import type { MusicThemeId } from '../content/types';
import type { SimEvent } from '../sim/events';
import { createMusicPlayer, type MusicPlayer } from './music';
import { humFor, isBossKill, PER_FRAME_CAPS, screenCue, sfxFor, type SfxName } from './sfx';
import { bossThemeOf, THEMES, type ThemeId } from './themes';
import { playSfx, startWellHum, type Loop, type VoiceBed } from './voices';

/** What the test bridge reports: no context yet, or the context's own state. */
export type AudioState = 'none' | 'suspended' | 'running' | 'closed';

/** How loud the music is relative to its volume setting. */
export type MusicLevel = 'play' | 'paused' | 'menu';

/** Play and pause have their own music level; every other screen plays the menu's. */
export const musicFor = (screen: Screen): MusicLevel => (screen === 'playing' ? 'play' : screen === 'paused' ? 'paused' : 'menu');

/** Whether sound is wanted but waits for a key press or tap to start (or wake) the context: not muted, not failed, not running. */
export function needsSoundGesture(state: AudioState, muted: boolean): boolean {
  return !muted && (state === 'none' || state === 'suspended');
}

export interface AudioEngine {
  readonly state: AudioState;
  readonly muted: boolean;
  /** The music theme chosen: it starts at the next bar line, and a menu plays the last Dimension's. The Drift before any galaxy. */
  readonly theme: ThemeId;
  /** Starts a new frame, which resets the per-frame caps on shots and drone swarms. */
  beginFrame(): void;
  /**
   * Plays the sound for each event that makes one, at its cue's delay (a boss kill's warp waits for the boss), and
   * starts or stops the gravity well's hum. The hum plays only in play: pause silences it until play resumes, and any
   * other screen, a mute or dispose stops it. A galaxy's start picks its theme, and a boss's intro its boss variant.
   */
  handle(events: readonly SimEvent[]): void;
  /** Plays `name`, `delay` seconds from now on the audio clock. */
  play(name: SfxName, delay?: number): void;
  /** A new screen: its music level, and the sound it opens with (the clear fanfare on the results card). */
  setScreen(screen: Screen): void;
  setMuted(muted: boolean): void;
  /** Sets the music and effects volumes (0–1); they take hold at once, even mid-sound. */
  setVolumes(music: number, sfx: number): void;
  setMusicLevel(level: MusicLevel): void;
  dispose(): void;
}

const MUSIC_LEVELS: Readonly<Record<MusicLevel, number>> = { play: 1, paused: 0.3, menu: 0.45 };
/** The sounds with a per-frame cap, listed once so a new frame resets them without allocating. */
const CAPPED_SOUNDS = Object.keys(PER_FRAME_CAPS) as readonly SfxName[];
const MUSIC_LOWPASS_HZ = 2600;
/** Seconds of settling for gain changes (mute, music level): fast enough to feel instant, slow enough not to click. */
const MUTE_SMOOTHING = 0.015;
const LEVEL_SMOOTHING = 0.15;
const NOISE_SECONDS = 1.5;

interface Graph {
  readonly ctx: AudioContext;
  readonly bed: VoiceBed;
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly music: GainNode;
  readonly player: MusicPlayer;
}

function createNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Contexts already told to close, so a failure followed by dispose closes each one once. */
const closing = new WeakSet<AudioContext>();

/** Releases the audio device. A refusal (already closed, or the browser is mid-failure) leaves nothing more to do. */
function closeContext(ctx: AudioContext): void {
  if (closing.has(ctx)) return;
  closing.add(ctx);
  try {
    ctx.close().catch(() => undefined);
  } catch {
    // The context is unusable and being abandoned; there is no one left to tell.
  }
}

function ramp(param: AudioParam, ctx: AudioContext, value: number, smoothing: number): void {
  param.setTargetAtTime(value, ctx.currentTime, smoothing);
}

/**
 * Synthesized sound and music. No AudioContext exists until the first pointer or key press (browsers
 * only allow audio after a gesture), and a missing or blocked WebAudio turns every call into a
 * no-op, so the game never depends on sound. Gesture listeners stay until the context is running,
 * because some gestures (a touch's pointerdown, Escape) do not grant permission to start audio, and
 * they come back whenever it stops again while sound is wanted (a refused resume on returning to the
 * tab, or an interruption such as a phone call).
 * Nothing is built while the context is not running or while muted: a suspended clock never ends a
 * voice, so queued voices would pile up and then all sound at once.
 *
 * Graph: (screen bus →) sfx gain ──┐
 *        music gain → 2.6 kHz lowpass ┴→ master gain → compressor (−14 dB, 4:1) → output
 * The screen bus carries the open screen's own sound, the clear fanfare; a new screen fades it out.
 */
export function createAudioEngine(initial: Settings, onFailure: (message: string) => void = console.warn): AudioEngine {
  let graph: Graph | null = null;
  let broken = false;
  let disposed = false;
  let muted = initial.muted;
  let musicVolume = initial.musicVolume;
  let sfxVolume = initial.sfxVolume;
  let musicLevel: MusicLevel = 'menu';
  /** How many times each capped sound has started this frame. */
  const startedThisFrame: Partial<Record<SfxName, number>> = {};
  /** Whether a well is pulling, as the events last told; and whether the screen is play, where the hum is heard. */
  let humWanted = false;
  let inPlay = false;
  let hum: Loop | null = null;
  /** The bus the open screen's own sound (the clear fanfare) plays through, so leaving the screen can fade it out. */
  let screenBus: GainNode | null = null;
  /** The theme of the last galaxy started, and whether its boss has appeared; together they choose the music. */
  let galaxyTheme: MusicThemeId = 'drift';
  let bossFight = false;
  let theme: ThemeId = 'drift';

  /** The music bus gain for `level`: the saved volume scaled by the mode's level. */
  const musicGain = (level: MusicLevel): number => musicVolume * MUSIC_LEVELS[level];

  /** Runs WebAudio work; a failure disables sound for good (once, with a warning) instead of throwing into the game. */
  function guard(work: () => void): void {
    if (broken) return;
    try {
      work();
    } catch (error) {
      broken = true;
      if (graph !== null) {
        graph.player.stop();
        closeContext(graph.ctx);
      }
      onFailure(
        `Sound is off: the browser's audio failed (${error instanceof Error ? error.message : String(error)}). Reload the page or try another browser to get sound back.`,
      );
    }
  }

  /** Fire-and-forget for promise-returning audio calls: a refusal leaves the context's state as the record, which `onDone` then reads. */
  function settle(promise: Promise<void>, onDone?: () => void): void {
    promise.then(onDone, onDone).catch(() => undefined);
  }

  function buildGraph(): Graph {
    const ctx = new AudioContext();
    try {
      return wireGraph(ctx);
    } catch (error) {
      closeContext(ctx);
      throw error;
    }
  }

  function wireGraph(ctx: AudioContext): Graph {
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const music = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    master.gain.value = muted ? 0 : 1;
    sfx.gain.value = sfxVolume;
    music.gain.value = musicGain(musicLevel);
    lowpass.type = 'lowpass';
    lowpass.frequency.value = MUSIC_LOWPASS_HZ;
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    sfx.connect(master);
    music.connect(lowpass).connect(master);
    master.connect(compressor).connect(ctx.destination);
    // A call or Siri (`interrupted`) or the system can stop the context long after it first ran.
    ctx.onstatechange = () => {
      syncGestureListeners(ctx);
      syncHum();
    };
    const bed: VoiceBed = { ctx, noise: createNoise(ctx) };
    return { ctx, bed, master, sfx, music, player: createMusicPlayer(bed, music, guard, audible, THEMES[theme]) };
  }

  /** Whether sound should be made right now: the context is running and the player has not muted. */
  function audible(): boolean {
    return !muted && graph?.ctx.state === 'running';
  }

  /** Starts the hum when a well pulls in play and sound is audible, and stops it as soon as any of those ends. */
  function syncHum(): void {
    const current = graph;
    if (humWanted && inPlay && current !== null && audible()) {
      if (hum === null) {
        guard(() => {
          hum = startWellHum(current.bed, current.sfx);
        });
      }
      return;
    }
    const running = hum;
    hum = null;
    if (running !== null) {
      guard(() => {
        running.stop();
      });
    }
  }

  const gestureEvents = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
  function addGestureListeners(): void {
    for (const type of gestureEvents) window.addEventListener(type, onGesture);
  }
  function removeGestureListeners(): void {
    for (const type of gestureEvents) window.removeEventListener(type, onGesture);
  }

  /** Gestures are only needed while sound is wanted but the context is not running; adding twice is harmless. */
  function syncGestureListeners(ctx: AudioContext): void {
    if (ctx.state === 'running') removeGestureListeners();
    else if (!muted && !broken && !disposed && ctx.state !== 'closed') addGestureListeners();
  }

  /** Asks the context to run, then listens for gestures again if the browser refused. */
  function resumeContext(ctx: AudioContext): void {
    settle(ctx.resume(), () => {
      syncGestureListeners(ctx);
    });
  }

  /** Starts or wakes the context from a gesture; the listeners go once it is running. */
  function onGesture(): void {
    if (broken || disposed) {
      removeGestureListeners();
      return;
    }
    guard(() => {
      if (graph === null) {
        if (typeof AudioContext === 'undefined') throw new Error('this browser has no AudioContext');
        graph = buildGraph();
        graph.player.start();
        syncHum();
      }
      const { ctx } = graph;
      if (ctx.state === 'running') removeGestureListeners();
      else resumeContext(ctx);
    });
  }

  /** Moves both bus gains to the current volumes and music level. */
  function syncBusGains(): void {
    if (graph === null) return;
    const { ctx, music, sfx } = graph;
    guard(() => {
      ramp(music.gain, ctx, musicGain(musicLevel), LEVEL_SMOOTHING);
      ramp(sfx.gain, ctx, sfxVolume, LEVEL_SMOOTHING);
    });
  }

  function onVisibilityChange(): void {
    const current = graph;
    if (current === null) return;
    guard(() => {
      if (document.visibilityState === 'hidden') settle(current.ctx.suspend());
      else if (!muted) resumeContext(current.ctx);
    });
  }

  addGestureListeners();
  document.addEventListener('visibilitychange', onVisibilityChange);

  function setMusicLevel(level: MusicLevel): void {
    musicLevel = level;
    syncBusGains();
  }

  /** Fades out the last screen's sound, so a fanfare never runs on into the next run, and starts `screen`'s own. */
  function playScreenCue(screen: Screen): void {
    if (graph === null) return;
    const { ctx, bed, sfx } = graph;
    guard(() => {
      if (screenBus !== null) ramp(screenBus.gain, ctx, 0, MUTE_SMOOTHING);
      screenBus = null;
      const cue = screenCue(screen);
      if (cue === null || !audible()) return;
      screenBus = ctx.createGain();
      screenBus.connect(sfx);
      playSfx(bed, screenBus, cue.name, cue.delay);
    });
  }

  /**
   * Moves the music to the theme the galaxy and boss fight now call for. A new galaxy waits for the next bar line, but
   * a boss's variant for the next beat, to be playing by the end of its 2 s intro.
   */
  function syncTheme(): void {
    const next = bossFight ? bossThemeOf(galaxyTheme) : galaxyTheme;
    if (next === theme) return;
    theme = next;
    const current = graph;
    if (current === null) return;
    guard(() => {
      current.player.setTheme(THEMES[next], bossFight ? 'beat' : 'bar');
    });
  }

  /** A galaxy starting picks its theme and a boss appearing its boss variant; other events leave the music alone. */
  function followTheme(event: SimEvent): void {
    if (event.type === 'galaxyStart') {
      galaxyTheme = galaxyById(event.id).theme;
      bossFight = false;
    } else if (event.type === 'bossIntro') {
      bossFight = true;
    }
  }

  function play(name: SfxName, delay = 0): void {
    if (graph === null || !audible()) return;
    const cap = PER_FRAME_CAPS[name];
    if (cap !== undefined) {
      const started = (startedThisFrame[name] ?? 0) + 1;
      startedThisFrame[name] = started;
      if (started > cap) return;
    }
    const { bed, sfx } = graph;
    guard(() => {
      playSfx(bed, sfx, name, delay);
    });
  }

  return {
    get state(): AudioState {
      if (graph === null) return 'none';
      const { state } = graph.ctx;
      return state === 'running' || state === 'closed' ? state : 'suspended';
    },
    get muted() {
      return muted;
    },
    get theme() {
      return theme;
    },
    beginFrame() {
      for (const name of CAPPED_SOUNDS) startedThisFrame[name] = 0;
    },
    handle(events) {
      const bossKill = isBossKill(events);
      for (const event of events) {
        const cue = sfxFor(event, bossKill);
        if (cue !== null) play(cue.name, cue.delay);
        humWanted = humFor(event) ?? humWanted;
        followTheme(event);
      }
      syncHum();
      syncTheme();
    },
    play,
    setMuted(next) {
      muted = next;
      if (graph === null) return;
      const { ctx, master } = graph;
      guard(() => {
        ramp(master.gain, ctx, next ? 0 : 1, MUTE_SMOOTHING);
        // The page is visible when the player presses M; a context suspended while muted wakes here.
        if (!next && document.visibilityState === 'visible') resumeContext(ctx);
      });
      syncHum();
    },
    setVolumes(music, sfx) {
      musicVolume = music;
      sfxVolume = sfx;
      syncBusGains();
    },
    setMusicLevel,
    setScreen(screen) {
      inPlay = screen === 'playing';
      // Pause keeps the well and the boss fight in mind for the resume; any other screen leaves the run, and both with it
      // (the menus play the plain theme of the last Dimension).
      if (!inPlay && screen !== 'paused') {
        humWanted = false;
        bossFight = false;
      }
      syncHum();
      syncTheme();
      setMusicLevel(musicFor(screen));
      playScreenCue(screen);
    },
    dispose() {
      disposed = true;
      removeGestureListeners();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      humWanted = false;
      syncHum();
      const current = graph;
      graph = null;
      if (current === null) return;
      current.player.stop();
      closeContext(current.ctx);
    },
  };
}
