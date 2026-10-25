import { LOOKAHEAD_SECONDS, scheduleWindow, type Pattern, type PatternNote } from './sequencer';
import { playNote, type VoiceBed } from './voices';

export const DRIFT_BPM = 96;
const BEATS_PER_BAR = 4;
/** How often the scheduler wakes to top up the look-ahead window. */
const TICK_MS = 25;
/** Seconds between pressing start and the first beat, so the first notes are never late. */
const LEAD_SECONDS = 0.1;

/** One bar each: Am, F, C, G as a triad voicing, the bass root, and the arpeggio's eight-step shape. */
const CHORDS = [
  { bass: 45, tones: [57, 60, 64] },
  { bass: 41, tones: [57, 60, 65] },
  { bass: 48, tones: [55, 60, 64] },
  { bass: 43, tones: [55, 59, 62] },
] as const;
/** Indices into the chord's tones plus its root an octave up (3), played as eighth notes. */
const ARP_SHAPE = [0, 1, 2, 3, 2, 1, 3, 2] as const;
const ARP_OCTAVE = 12;

function barNotes(bar: number, chord: (typeof CHORDS)[number]): PatternNote[] {
  const start = bar * BEATS_PER_BAR;
  const [first] = chord.tones;
  const arpTones = [...chord.tones, first + ARP_OCTAVE];
  const arp = ARP_SHAPE.map((step, i): PatternNote => ({
    beat: start + i / 2,
    voice: 'arp',
    midi: (arpTones[step] ?? first) + ARP_OCTAVE,
    duration: 0.5,
    velocity: i % 2 === 0 ? 0.7 : 0.5,
  }));
  const bass: PatternNote[] = [0, 2].map((beat) => ({
    beat: start + beat,
    voice: 'bass',
    midi: chord.bass,
    duration: 2,
    velocity: beat === 0 ? 0.8 : 0.6,
  }));
  const pad: PatternNote[] = chord.tones.map((midi) => ({
    beat: start,
    voice: 'pad',
    midi,
    duration: BEATS_PER_BAR,
    velocity: 0.8,
  }));
  // Soft off-beat hats.
  const hats: PatternNote[] = [0.5, 1.5, 2.5, 3.5].map((beat) => ({
    beat: start + beat,
    voice: 'hat',
    midi: 0,
    duration: 0.12,
    velocity: 0.5,
  }));
  return [...pad, ...bass, ...arp, ...hats];
}

/** Drift: a calm four-bar loop (Am F C G) of arpeggio, bass, pad and hats at about 96 bpm. */
export const DRIFT: Pattern = {
  lengthBeats: CHORDS.length * BEATS_PER_BAR,
  notes: CHORDS.flatMap((chord, bar) => barNotes(bar, chord)),
};

export interface MusicPlayer {
  /** Starts the loop from its first beat; ignored while playing. */
  start(): void;
  stop(): void;
}

/**
 * Plays Drift into `out`. A 25 ms timer hands the audio clock the next 0.1 s of notes, so timer
 * jitter never reaches the beat; after a stall it picks up at the present instead of catching up.
 * `guard` runs each tick so a failing audio call is the caller's to contain.
 */
export function createMusicPlayer(bed: VoiceBed, out: AudioNode, guard: (work: () => void) => void): MusicPlayer {
  let timer: ReturnType<typeof setInterval> | null = null;
  let startTime = 0;
  let nextBeat = 0;

  const tick = (): void => {
    guard(() => {
      const batch = scheduleWindow(DRIFT, DRIFT_BPM, nextBeat, bed.ctx.currentTime + LOOKAHEAD_SECONDS, startTime);
      nextBeat = batch.nextBeat;
      for (const note of batch.events) playNote(bed, out, note);
    });
  };

  return {
    start() {
      if (timer !== null) return;
      startTime = bed.ctx.currentTime + LEAD_SECONDS;
      nextBeat = 0;
      timer = setInterval(tick, TICK_MS);
      tick();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
