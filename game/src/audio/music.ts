import { LOOKAHEAD_SECONDS, stepTimeline, type SwitchGrain, type Timeline } from './sequencer';
import { patternOf, type MusicTheme } from './themes';
import { playNote, type VoiceBed } from './voices';

/** How often the scheduler wakes to top up the look-ahead window. */
const TICK_MS = 25;
/** Seconds between pressing start and the first beat, so the first notes are never late. */
const LEAD_SECONDS = 0.1;
/** Seconds the old theme's bus takes to fade after a theme change: long enough to let its last notes ring out. */
const FADE_OUT_SECONDS = 0.35;
/** Seconds the new theme's bus takes to fade in, short enough to keep its first beat. */
const FADE_IN_SECONDS = 0.04;
/** How long after its fade ends a retired bus is disconnected. */
const RETIRE_GRACE_SECONDS = 0.1;

export interface MusicPlayer {
  /** Starts the loop from its first beat; ignored while playing. */
  start(): void;
  stop(): void;
  /**
   * Plays `theme` from the next bar line (or beat line, for a `grain` of 'beat'): the old theme's bar finishes, then
   * the new one starts from its first beat while the old bus fades out under it. Asking for the theme already playing
   * cancels a change still waiting. Before `start` it just picks the theme to start with.
   */
  setTheme(theme: MusicTheme, grain: SwitchGrain): void;
}

/** A theme's own bus, so it can be faded out as a whole when another takes over. */
interface Lane {
  readonly gain: GainNode;
  /** When a faded-out lane is disconnected, on the audio clock. */
  retireAt: number;
}

/**
 * Plays a theme into `out`. A 25 ms timer hands the audio clock the next 0.1 s of notes, so timer
 * jitter never reaches the beat; after a stall it picks up at the present instead of catching up.
 * `guard` runs each tick so a failing audio call is the caller's to contain. While `audible()` is
 * false (suspended or muted) nothing is scheduled; the beat clock keeps running, so music resumes
 * at the present through the same skip-ahead as a stall, and a theme change still waiting lands on
 * the first bar line after it.
 */
export function createMusicPlayer(
  bed: VoiceBed,
  out: AudioNode,
  guard: (work: () => void) => void,
  audible: () => boolean,
  initial: MusicTheme,
): MusicPlayer {
  let timer: ReturnType<typeof setInterval> | null = null;
  let theme = initial;
  let pending: MusicTheme | null = null;
  let pendingGrain: SwitchGrain = 'bar';
  let line: Timeline | null = null;
  let lane: Lane | null = null;
  const fading: Lane[] = [];

  const newLane = (gain: number): Lane => {
    const node = bed.ctx.createGain();
    node.gain.value = gain;
    node.connect(out);
    return { gain: node, retireAt: Infinity };
  };

  /** Fades `from` out and the new theme's bus in, around `at`, on the audio clock. */
  const crossfade = (from: Lane, to: Lane, at: number): void => {
    from.gain.gain.setValueAtTime(1, at);
    from.gain.gain.linearRampToValueAtTime(0, at + FADE_OUT_SECONDS);
    from.retireAt = at + FADE_OUT_SECONDS + RETIRE_GRACE_SECONDS;
    fading.push(from);
    to.gain.gain.setValueAtTime(0, at);
    to.gain.gain.linearRampToValueAtTime(1, at + FADE_IN_SECONDS);
  };

  const retire = (now: number): void => {
    for (let i = fading.length - 1; i >= 0; i--) {
      const old = fading[i] as Lane;
      if (old.retireAt > now) continue;
      old.gain.disconnect();
      fading.splice(i, 1);
    }
  };

  const tick = (): void => {
    guard(() => {
      if (line === null || lane === null) return;
      const now = bed.ctx.currentTime;
      retire(now);
      if (!audible()) return;
      const changing = pending;
      const step = stepTimeline(line, changing === null ? null : { pattern: patternOf(changing), bpm: changing.bpm }, now + LOOKAHEAD_SECONDS, pendingGrain);
      line = step.line;
      if (changing === null || step.switchedAt === null) {
        for (const note of step.events) playNote(bed, lane.gain, note);
        return;
      }
      // The notes before the bar line belong to the old theme, the rest to the new one.
      const old = lane;
      lane = newLane(0);
      crossfade(old, lane, step.switchedAt);
      theme = changing;
      pending = null;
      for (const note of step.events) playNote(bed, note.time < step.switchedAt ? old.gain : lane.gain, note);
    });
  };

  return {
    start() {
      if (timer !== null) return;
      if (pending !== null) theme = pending;
      pending = null;
      line = { pattern: patternOf(theme), bpm: theme.bpm, startTime: bed.ctx.currentTime + LEAD_SECONDS, nextBeat: 0 };
      guard(() => {
        lane = newLane(1);
      });
      timer = setInterval(tick, TICK_MS);
      tick();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      for (const old of [...fading, ...(lane === null ? [] : [lane])]) old.gain.disconnect();
      fading.length = 0;
      lane = null;
      line = null;
    },
    setTheme(next, grain) {
      pendingGrain = grain;
      if (timer === null) {
        theme = next;
        pending = null;
      } else if (next.id === theme.id) {
        pending = null;
      } else {
        pending = next;
      }
    },
  };
}
