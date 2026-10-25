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
  const secondsPerBeat = 60 / bpm;
  const toBeat = (toTime - startTime) / secondsPerBeat;
  const nowBeat = toBeat - LOOKAHEAD_SECONDS / secondsPerBeat;
  const lagBeats = nowBeat - fromBeat;
  const from = lagBeats * secondsPerBeat > LOOKAHEAD_SECONDS ? nowBeat : fromBeat;
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
