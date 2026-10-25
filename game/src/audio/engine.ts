import type { Settings } from '../app/settings';
import type { SimEvent } from '../sim/events';
import { createMusicPlayer, type MusicPlayer } from './music';
import { sfxFor, type SfxName } from './sfx';
import { playSfx, type VoiceBed } from './voices';

/** What the test bridge reports: no context yet, or the context's own state. */
export type AudioState = 'none' | 'suspended' | 'running' | 'closed';

/** How loud the music is relative to its volume setting. */
export type MusicLevel = 'play' | 'paused' | 'menu';

export interface AudioEngine {
  readonly state: AudioState;
  readonly muted: boolean;
  /** Starts a new frame, which resets the shot cap. */
  beginFrame(): void;
  /** Plays the sound for each event that makes one. */
  handle(events: readonly SimEvent[]): void;
  play(name: SfxName): void;
  setMuted(muted: boolean): void;
  setMusicLevel(level: MusicLevel): void;
  dispose(): void;
}

const MUSIC_LEVELS: Readonly<Record<MusicLevel, number>> = { play: 1, paused: 0.3, menu: 0.45 };
/** Shots per frame beyond this are dropped: held fire plus a hit-stop catch-up would otherwise stack blips. */
const MAX_SHOTS_PER_FRAME = 3;
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

function ramp(param: AudioParam, ctx: AudioContext, value: number, smoothing: number): void {
  param.setTargetAtTime(value, ctx.currentTime, smoothing);
}

/**
 * Synthesized sound and music. No AudioContext exists until the first pointer or key press (browsers
 * only allow audio after a gesture), and a missing or blocked WebAudio turns every call into a
 * no-op, so the game never depends on sound.
 *
 * Graph: sfx gain ─────────────────┐
 *        music gain → 2.6 kHz lowpass ┴→ master gain → compressor (−14 dB, 4:1) → output
 */
export function createAudioEngine(initial: Settings, onFailure: (message: string) => void = console.warn): AudioEngine {
  let graph: Graph | null = null;
  let broken = false;
  let disposed = false;
  let muted = initial.muted;
  let musicLevel: MusicLevel = 'menu';
  let shotsThisFrame = 0;

  /** Runs WebAudio work; a failure disables sound for good (once, with a warning) instead of throwing into the game. */
  function guard(work: () => void): void {
    if (broken) return;
    try {
      work();
    } catch (error) {
      broken = true;
      graph?.player.stop();
      onFailure(
        `Sound is off: the browser's audio failed (${error instanceof Error ? error.message : String(error)}). Reload the page or try another browser to get sound back.`,
      );
    }
  }

  /** Fire-and-forget for promise-returning audio calls: a refusal leaves the context's state as the record. */
  function settle(promise: Promise<void>): void {
    promise.catch(() => undefined);
  }

  function buildGraph(): Graph {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const music = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    master.gain.value = muted ? 0 : 1;
    sfx.gain.value = initial.sfxVolume;
    music.gain.value = initial.musicVolume * MUSIC_LEVELS[musicLevel];
    lowpass.type = 'lowpass';
    lowpass.frequency.value = MUSIC_LOWPASS_HZ;
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    sfx.connect(master);
    music.connect(lowpass).connect(master);
    master.connect(compressor).connect(ctx.destination);
    const bed: VoiceBed = { ctx, noise: createNoise(ctx) };
    return { ctx, bed, master, sfx, music, player: createMusicPlayer(bed, music, guard) };
  }

  const unlockEvents = ['pointerdown', 'keydown'] as const;
  function removeUnlockListeners(): void {
    for (const type of unlockEvents) window.removeEventListener(type, unlock);
  }

  function unlock(): void {
    removeUnlockListeners();
    if (graph !== null || broken || disposed) return;
    guard(() => {
      if (typeof AudioContext === 'undefined') throw new Error('this browser has no AudioContext');
      const built = buildGraph();
      graph = built;
      settle(built.ctx.resume());
      built.player.start();
    });
  }

  function onVisibilityChange(): void {
    const current = graph;
    if (current === null) return;
    guard(() => {
      if (document.visibilityState === 'hidden') settle(current.ctx.suspend());
      else if (!muted) settle(current.ctx.resume());
    });
  }

  for (const type of unlockEvents) window.addEventListener(type, unlock);
  document.addEventListener('visibilitychange', onVisibilityChange);

  function play(name: SfxName): void {
    if (graph === null) return;
    if (name === 'shoot' && ++shotsThisFrame > MAX_SHOTS_PER_FRAME) return;
    const { bed, sfx } = graph;
    guard(() => {
      playSfx(bed, sfx, name);
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
    beginFrame() {
      shotsThisFrame = 0;
    },
    handle(events) {
      for (const event of events) {
        const name = sfxFor(event);
        if (name !== null) play(name);
      }
    },
    play,
    setMuted(next) {
      muted = next;
      if (graph === null) return;
      const { ctx, master } = graph;
      guard(() => {
        ramp(master.gain, ctx, next ? 0 : 1, MUTE_SMOOTHING);
        // The page is visible when the player presses M; a context suspended while muted wakes here.
        if (!next && document.visibilityState === 'visible') settle(ctx.resume());
      });
    },
    setMusicLevel(level) {
      musicLevel = level;
      if (graph === null) return;
      const { ctx, music } = graph;
      guard(() => {
        ramp(music.gain, ctx, initial.musicVolume * MUSIC_LEVELS[level], LEVEL_SMOOTHING);
      });
    },
    dispose() {
      disposed = true;
      removeUnlockListeners();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const current = graph;
      graph = null;
      if (current === null) return;
      current.player.stop();
      guard(() => {
        settle(current.ctx.close());
      });
    },
  };
}
