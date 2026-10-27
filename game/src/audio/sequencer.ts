export type VoiceName = 'arp' | 'bass' | 'pad' | 'hat';

export interface NoteEvent {
  /** Seconds on the audio clock. */
  readonly time: number;
  readonly voice: VoiceName;
  readonly midi: number;
  /** Seconds. */
  readonly duration: number;
  /** 0–1 */
  readonly velocity: number;
}

export interface PatternNote {
  /** Position inside the loop, in beats from its start. */
  readonly beat: number;
  readonly voice: VoiceName;
  readonly midi: number;
  /** Beats. */
  readonly duration: number;
  readonly velocity: number;
}

/** A loop of `lengthBeats` beats; every note's `beat` is in [0, lengthBeats). */
export interface Pattern {
  readonly lengthBeats: number;
  readonly notes: readonly PatternNote[];
}

/** How far ahead of the audio clock notes are handed to the audio graph. */
export const LOOKAHEAD_SECONDS = 0.1;

/** Beats in a bar: themes are written in bars, and a theme change lands on a bar line (or a beat line, see `SwitchGrain`). */
export const BEATS_PER_BAR = 4;

/** The beat at audio time `time` of a theme whose beat 0 sounded at `startTime`. */
const beatAt = (bpm: number, time: number, startTime: number): number => ((time - startTime) * bpm) / 60;

/** The beat a window ending at `toTime` starts from: `fromBeat`, or now if that fell more than one look-ahead behind (a stalled timer). */
function windowStart(bpm: number, fromBeat: number, toTime: number, startTime: number): number {
  const nowBeat = beatAt(bpm, toTime - LOOKAHEAD_SECONDS, startTime);
  return ((nowBeat - fromBeat) * 60) / bpm > LOOKAHEAD_SECONDS ? nowBeat : fromBeat;
}

/** The notes of `pattern` looped from `startTime` that fall in [`from`, `toBeat`), and the beat to continue from. */
function window(pattern: Pattern, bpm: number, from: number, toBeat: number, startTime: number): { events: NoteEvent[]; nextBeat: number } {
  const secondsPerBeat = 60 / bpm;
  const events: NoteEvent[] = [];
  const { lengthBeats, notes } = pattern;
  for (let loop = Math.floor(from / lengthBeats); loop * lengthBeats < toBeat; loop++) {
    for (const note of notes) {
      const beat = loop * lengthBeats + note.beat;
      if (beat < from || beat >= toBeat) continue;
      events.push({
        time: startTime + beat * secondsPerBeat,
        voice: note.voice,
        midi: note.midi,
        duration: note.duration * secondsPerBeat,
        velocity: note.velocity,
      });
    }
  }
  events.sort((a, b) => a.time - b.time);
  return { events, nextBeat: Math.max(from, toBeat) };
}

/**
 * The notes that fall in [`fromBeat`, the beat at `toTime`) of `pattern` looped from `startTime`,
 * and the beat to continue from. Beats count from `startTime` and never wrap, so consecutive
 * windows tile exactly: a note is scheduled once, even across the loop boundary.
 * `toTime` is now plus one look-ahead; if `fromBeat` fell more than one look-ahead behind now
 * (a stalled timer), the window starts at now instead of replaying the notes that were missed.
 */
export function scheduleWindow(
  pattern: Pattern,
  bpm: number,
  fromBeat: number,
  toTime: number,
  startTime: number,
): { events: NoteEvent[]; nextBeat: number } {
  return window(pattern, bpm, windowStart(bpm, fromBeat, toTime, startTime), beatAt(bpm, toTime, startTime), startTime);
}

/** A theme as the scheduler plays it. */
export interface Playable {
  readonly pattern: Pattern;
  readonly bpm: number;
}

/** What is playing: a theme, the audio time its beat 0 sounded, and the beat the next window continues from. */
export interface Timeline extends Playable {
  readonly startTime: number;
  readonly nextBeat: number;
}

/** How soon a theme change lands: on the next bar line, or the next beat line. */
export type SwitchGrain = 'bar' | 'beat';

/**
 * One timer tick of a theme that can change: the notes up to `toTime`, and the timeline to continue from. With
 * `next` set, the change waits for the first `grain` line (bar or beat) not yet scheduled, so every bar or beat is
 * played whole: the old theme's notes stop short of it, and `next`'s beat 0 sounds on it, at `next`'s tempo.
 * `switchedAt` is that audio time, or null when the tick did not reach it (the caller keeps passing `next` until it
 * does). The line is a whole beat, and the old window ends on that beat rather than on a time worked back to one, so
 * no rounding at an awkward tempo can leave an old note on the switch.
 */
export function stepTimeline(
  line: Timeline,
  next: Playable | null,
  toTime: number,
  grain: SwitchGrain,
): { events: NoteEvent[]; line: Timeline; switchedAt: number | null } {
  const from = windowStart(line.bpm, line.nextBeat, toTime, line.startTime);
  if (next !== null) {
    const quantum = grain === 'bar' ? BEATS_PER_BAR : 1;
    const switchBeat = Math.ceil(from / quantum) * quantum;
    const switchedAt = line.startTime + switchBeat * (60 / line.bpm);
    if (switchedAt < toTime) {
      const old = window(line.pattern, line.bpm, from, switchBeat, line.startTime);
      const fresh = window(next.pattern, next.bpm, 0, beatAt(next.bpm, toTime, switchedAt), switchedAt);
      return {
        events: [...old.events.filter((e) => e.time < switchedAt), ...fresh.events],
        line: { pattern: next.pattern, bpm: next.bpm, startTime: switchedAt, nextBeat: fresh.nextBeat },
        switchedAt,
      };
    }
  }
  const now = window(line.pattern, line.bpm, from, beatAt(line.bpm, toTime, line.startTime), line.startTime);
  return { events: now.events, line: { ...line, nextBeat: now.nextBeat }, switchedAt: null };
}
