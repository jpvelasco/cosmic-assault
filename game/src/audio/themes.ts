import type { MusicThemeId } from '../content/types';
import { BEATS_PER_BAR, type Pattern, type PatternNote } from './sequencer';

/** A music theme, or the heavier variant of one that plays through a boss fight. */
export type ThemeId = MusicThemeId | `${MusicThemeId}Boss`;

/** One bar of a loop: the bass root and the pad's triad, as MIDI notes. */
export interface Chord {
  readonly bass: number;
  readonly tones: readonly [number, number, number];
}

export interface Key {
  /** The tonic's pitch class, 0 (C) to 11. */
  readonly tonic: number;
  /** Semitones above the tonic of the seven scale degrees. */
  readonly scale: readonly number[];
}

/** A bass or hat hit inside one bar. `lift` is semitones above the chord's bass root. */
export interface BassHit {
  readonly beat: number;
  readonly duration: number;
  readonly velocity: number;
  readonly lift: number;
}

export interface HatHit {
  readonly beat: number;
  readonly duration: number;
  readonly velocity: number;
}

/** What each part plays in every bar, whatever the chord. */
export interface Patterns {
  /**
   * The arpeggio steps through the chord's tones, with its root an octave up as a fourth (index 3), `lift` semitones
   * higher, one step every `step` beats. `shape` holds the indexes of a bar's steps, so `shape.length × step` is one
   * bar. Steps on every `accentEvery`th beat-slot play at `accent`, the rest at `soft`.
   */
  readonly arp: {
    readonly step: number;
    readonly shape: readonly number[];
    readonly lift: number;
    readonly accentEvery: number;
    readonly accent: number;
    readonly soft: number;
  };
  readonly bass: readonly BassHit[];
  readonly hats: readonly HatHit[];
  /** The pad's velocity; it holds the chord for the whole bar. */
  readonly pad: number;
}

export interface MusicTheme {
  readonly id: ThemeId;
  readonly bpm: number;
  readonly key: Key;
  /** One chord a bar; the theme loops after the last. */
  readonly chords: readonly Chord[];
  readonly patterns: Patterns;
}

const OCTAVE = 12;
/** The root of each chord's triad is the arpeggio's fourth tone, an octave up. */
const ARP_TOP = 3;

/** Every beat of a bar at `step` spacing, as hits with `make`. */
const every = <T>(step: number, make: (beat: number, i: number) => T): T[] =>
  Array.from({ length: BEATS_PER_BAR / step }, (_, i) => make(i * step, i));

const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const PHRYGIAN_DOMINANT = [0, 1, 4, 5, 7, 8, 10] as const;
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11] as const;

/** Calm: Am F C G at 96 bpm, an eighth-note arpeggio over two long bass notes and soft off-beat hats. */
const DRIFT_THEME: MusicTheme = {
  id: 'drift',
  bpm: 96,
  key: { tonic: 9, scale: NATURAL_MINOR },
  chords: [
    { bass: 45, tones: [57, 60, 64] },
    { bass: 41, tones: [57, 60, 65] },
    { bass: 48, tones: [55, 60, 64] },
    { bass: 43, tones: [55, 59, 62] },
  ],
  patterns: {
    arp: { step: 0.5, shape: [0, 1, 2, 3, 2, 1, 3, 2], lift: OCTAVE, accentEvery: 2, accent: 0.7, soft: 0.5 },
    bass: [
      { beat: 0, duration: 2, velocity: 0.8, lift: 0 },
      { beat: 2, duration: 2, velocity: 0.6, lift: 0 },
    ],
    hats: [0.5, 1.5, 2.5, 3.5].map((beat) => ({ beat, duration: 0.12, velocity: 0.5 })),
    pad: 0.8,
  },
};

/**
 * Brisk and bright: D A Bm G at 110 bpm, a sixteenth-note arpeggio that lives on the upper tones over a syncopated bass, with
 * a sixteenth pick-up on the hats.
 */
const ION_REACH_THEME: MusicTheme = {
  id: 'ionReach',
  bpm: 110,
  key: { tonic: 2, scale: MAJOR },
  chords: [
    { bass: 38, tones: [57, 62, 66] },
    { bass: 45, tones: [57, 61, 64] },
    { bass: 47, tones: [59, 62, 66] },
    { bass: 43, tones: [59, 62, 67] },
  ],
  patterns: {
    arp: { step: 0.25, shape: [0, 1, 2, 3, 2, 1, 2, 3, 1, 2, 3, 2, 3, 2, 3, 1], lift: OCTAVE, accentEvery: 4, accent: 0.7, soft: 0.42 },
    bass: [
      { beat: 0, duration: 1.5, velocity: 0.8, lift: 0 },
      { beat: 1.5, duration: 0.5, velocity: 0.55, lift: 0 },
      { beat: 2, duration: 1, velocity: 0.7, lift: 0 },
      { beat: 3.5, duration: 0.5, velocity: 0.5, lift: OCTAVE },
    ],
    hats: [
      ...[0.5, 1.5, 2.5, 3.5].map((beat) => ({ beat, duration: 0.12, velocity: 0.5 })),
      { beat: 3.75, duration: 0.08, velocity: 0.3 },
    ],
    pad: 0.75,
  },
};

/**
 * Tense: D Eb Gm Cm at 116 bpm in D Phrygian dominant. A restless eighth-note arpeggio over a galloping bass, with the
 * hats ticking between the beats.
 */
const CRIMSON_NEBULA_THEME: MusicTheme = {
  id: 'crimsonNebula',
  bpm: 116,
  key: { tonic: 2, scale: PHRYGIAN_DOMINANT },
  chords: [
    { bass: 38, tones: [57, 62, 66] },
    { bass: 39, tones: [58, 63, 67] },
    { bass: 43, tones: [58, 62, 67] },
    { bass: 36, tones: [55, 60, 63] },
  ],
  patterns: {
    arp: { step: 0.5, shape: [0, 2, 1, 3, 2, 1, 3, 2], lift: OCTAVE, accentEvery: 2, accent: 0.7, soft: 0.45 },
    bass: [
      { beat: 0, duration: 0.75, velocity: 0.85, lift: 0 },
      { beat: 0.75, duration: 0.25, velocity: 0.5, lift: 0 },
      { beat: 1.5, duration: 0.5, velocity: 0.6, lift: 0 },
      { beat: 2, duration: 0.75, velocity: 0.8, lift: 0 },
      { beat: 2.75, duration: 0.25, velocity: 0.5, lift: 0 },
      { beat: 3.5, duration: 0.5, velocity: 0.6, lift: OCTAVE },
    ],
    hats: [
      ...[0.5, 1.5, 2.5, 3.5].map((beat) => ({ beat, duration: 0.1, velocity: 0.5 })),
      { beat: 3.75, duration: 0.08, velocity: 0.3 },
    ],
    pad: 0.7,
  },
};

/**
 * Eerie and sparse: Bbm Gb Db Ab at 100 bpm in B flat minor. A slow quarter-note arpeggio and one long bass note a
 * bar, under a wide pad that stacks its tones a fifth and a minor sixth apart.
 */
const VOID_RIFT_THEME: MusicTheme = {
  id: 'voidRift',
  bpm: 100,
  key: { tonic: 10, scale: NATURAL_MINOR },
  chords: [
    { bass: 34, tones: [58, 65, 73] },
    { bass: 30, tones: [58, 66, 73] },
    { bass: 37, tones: [60, 65, 73] },
    { bass: 32, tones: [60, 68, 75] },
  ],
  patterns: {
    arp: { step: 1, shape: [0, 2, 1, 3], lift: OCTAVE, accentEvery: 2, accent: 0.55, soft: 0.35 },
    bass: [{ beat: 0, duration: 3.5, velocity: 0.7, lift: 0 }],
    hats: [1.5, 3.5].map((beat) => ({ beat, duration: 0.1, velocity: 0.3 })),
    pad: 0.9,
  },
};

/**
 * Driving: Em C Am B at 124 bpm in E harmonic minor, the B major chord leaning back into the loop. A sixteenth-note
 * arpeggio over a pushing bass, with the hats running off the beat.
 */
const SINGULARITY_THEME: MusicTheme = {
  id: 'singularity',
  bpm: 124,
  key: { tonic: 4, scale: HARMONIC_MINOR },
  chords: [
    { bass: 40, tones: [55, 59, 64] },
    { bass: 36, tones: [55, 60, 64] },
    { bass: 33, tones: [57, 60, 64] },
    { bass: 35, tones: [59, 63, 66] },
  ],
  patterns: {
    arp: { step: 0.25, shape: [0, 1, 2, 3, 2, 1, 3, 2, 0, 1, 2, 3, 3, 2, 1, 2], lift: OCTAVE, accentEvery: 4, accent: 0.7, soft: 0.4 },
    bass: [
      { beat: 0, duration: 0.5, velocity: 0.85, lift: 0 },
      { beat: 0.75, duration: 0.25, velocity: 0.6, lift: 0 },
      { beat: 1.5, duration: 0.5, velocity: 0.7, lift: 0 },
      { beat: 2, duration: 0.5, velocity: 0.8, lift: 0 },
      { beat: 2.75, duration: 0.25, velocity: 0.6, lift: 0 },
      { beat: 3.5, duration: 0.5, velocity: 0.7, lift: OCTAVE },
    ],
    hats: [0.5, 0.75, 1.5, 1.75, 2.5, 2.75, 3.5, 3.75].map((beat, i) => ({ beat, duration: 0.07, velocity: i % 2 === 0 ? 0.5 : 0.3 })),
    pad: 0.6,
  },
};

/** The bass hits on every eighth with an octave pop on the second half of beats 2 and 4. */
const DRIVING_BASS: readonly BassHit[] = every(0.5, (beat, i) => ({
  beat,
  duration: 0.45,
  velocity: i % 2 === 0 ? 0.95 : 0.7,
  lift: i === 3 || i === 7 ? OCTAVE : 0,
}));

/** Sixteenth hats: the eighths strong, the sixteenths between them ghosted. */
const DRIVING_HATS: readonly HatHit[] = every(0.25, (beat, i) => ({ beat, duration: 0.08, velocity: i % 2 === 0 ? 0.6 : 0.3 }));

/** `base`'s key and chords at `bpm`, with a pounding bass, driving hats and the arpeggio pulled back to sit over them. */
function bossVariant(base: MusicTheme, id: ThemeId, bpm: number): MusicTheme {
  const { arp } = base.patterns;
  return {
    id,
    bpm,
    key: base.key,
    chords: base.chords,
    patterns: { ...base.patterns, arp: { ...arp, lift: OCTAVE, accent: arp.accent * 0.8, soft: arp.soft * 0.8 }, bass: DRIVING_BASS, hats: DRIVING_HATS },
  };
}

export const THEMES: Readonly<Record<ThemeId, MusicTheme>> = {
  drift: DRIFT_THEME,
  ionReach: ION_REACH_THEME,
  driftBoss: bossVariant(DRIFT_THEME, 'driftBoss', 112),
  ionReachBoss: bossVariant(ION_REACH_THEME, 'ionReachBoss', 126),
  crimsonNebula: CRIMSON_NEBULA_THEME,
  voidRift: VOID_RIFT_THEME,
  singularity: SINGULARITY_THEME,
  crimsonNebulaBoss: bossVariant(CRIMSON_NEBULA_THEME, 'crimsonNebulaBoss', 132),
  voidRiftBoss: bossVariant(VOID_RIFT_THEME, 'voidRiftBoss', 112),
  singularityBoss: bossVariant(SINGULARITY_THEME, 'singularityBoss', 140),
};

export const THEME_IDS = Object.keys(THEMES) as readonly ThemeId[];

/** The boss variant of music theme `id`. */
export const bossThemeOf = (id: MusicThemeId): ThemeId => `${id}Boss`;

function barNotes(bar: number, chord: Chord, { arp, bass, hats, pad }: Patterns): PatternNote[] {
  const start = bar * BEATS_PER_BAR;
  const [first] = chord.tones;
  const arpTones = [...chord.tones, first + OCTAVE];
  return [
    ...chord.tones.map((midi): PatternNote => ({ beat: start, voice: 'pad', midi, duration: BEATS_PER_BAR, velocity: pad })),
    ...bass.map((hit): PatternNote => ({ beat: start + hit.beat, voice: 'bass', midi: chord.bass + hit.lift, duration: hit.duration, velocity: hit.velocity })),
    ...arp.shape.map((index, i): PatternNote => ({
      beat: start + i * arp.step,
      voice: 'arp',
      midi: (arpTones[index] ?? arpTones[ARP_TOP] ?? first) + arp.lift,
      duration: arp.step,
      velocity: i % arp.accentEvery === 0 ? arp.accent : arp.soft,
    })),
    ...hats.map((hit): PatternNote => ({ beat: start + hit.beat, voice: 'hat', midi: 0, duration: hit.duration, velocity: hit.velocity })),
  ];
}

const patterns = new WeakMap<MusicTheme, Pattern>();

/** The loop `theme` plays: each bar's pad, bass, arpeggio and hats over its chord. Built once per theme. */
export function patternOf(theme: MusicTheme): Pattern {
  let pattern = patterns.get(theme);
  if (pattern === undefined) {
    pattern = { lengthBeats: theme.chords.length * BEATS_PER_BAR, notes: theme.chords.flatMap((chord, bar) => barNotes(bar, chord, theme.patterns)) };
    patterns.set(theme, pattern);
  }
  return pattern;
}
