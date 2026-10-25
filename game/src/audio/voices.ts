import type { NoteEvent, VoiceName } from './sequencer';
import type { SfxName } from './sfx';

/** What every synthesized sound needs: the context to build nodes in and one shared second of noise. */
export interface VoiceBed {
  readonly ctx: AudioContext;
  readonly noise: AudioBuffer;
}

/** Gain floor for exponential ramps, which cannot reach 0. */
const SILENCE = 0.0001;
/** Voices stop a hair after their envelope ends so the tail never clicks. */
const TAIL = 0.03;

interface ToneSpec {
  readonly type: OscillatorType;
  readonly from: number;
  /** Hz at the end of the sound; omit to hold `from`. */
  readonly to?: number;
  readonly start: number;
  readonly duration: number;
  readonly peak: number;
  /** Seconds to ramp up; default is a click-free 5 ms. */
  readonly attack?: number;
  /** Cents. */
  readonly detune?: number;
}

interface NoiseSpec {
  readonly filter: BiquadFilterType;
  readonly from: number;
  readonly to?: number;
  readonly q?: number;
  readonly start: number;
  readonly duration: number;
  readonly peak: number;
}

function envelope(gain: GainNode, start: number, duration: number, peak: number, attack: number): void {
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENCE, start + duration);
}

function sweep(param: AudioParam, from: number, to: number | undefined, start: number, duration: number): void {
  param.setValueAtTime(from, start);
  if (to !== undefined) param.exponentialRampToValueAtTime(to, start + duration);
}

/** One oscillator through its own envelope into `out`; it stops and disconnects itself when done. */
function tone({ ctx }: VoiceBed, out: AudioNode, spec: ToneSpec): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type;
  osc.detune.value = spec.detune ?? 0;
  sweep(osc.frequency, spec.from, spec.to, spec.start, spec.duration);
  envelope(gain, spec.start, spec.duration, spec.peak, spec.attack ?? 0.005);
  osc.connect(gain).connect(out);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(spec.start);
  osc.stop(spec.start + spec.duration + TAIL);
}

/** A slice of the shared noise through a (sweeping) filter and an envelope into `out`; it cleans itself up. */
function noiseBurst({ ctx, noise }: VoiceBed, out: AudioNode, spec: NoiseSpec): void {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noise;
  filter.type = spec.filter;
  filter.Q.value = spec.q ?? 0.7;
  sweep(filter.frequency, spec.from, spec.to, spec.start, spec.duration);
  envelope(gain, spec.start, spec.duration, spec.peak, 0.004);
  source.connect(filter).connect(gain).connect(out);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  const room = Math.max(0, noise.duration - spec.duration - TAIL);
  source.start(spec.start, Math.random() * room);
  source.stop(spec.start + spec.duration + TAIL);
}

interface Boom {
  readonly duration: number;
  readonly noiseFrom: number;
  readonly noiseTo: number;
  readonly noisePeak: number;
  readonly thudFrom: number;
  readonly thudTo: number;
  readonly thudPeak: number;
}

/** Bigger asteroids: longer, lower, louder. */
const BOOMS: Readonly<Record<'boomLarge' | 'boomMedium' | 'boomSmall' | 'boomTiny', Boom>> = {
  boomLarge: { duration: 0.7, noiseFrom: 1800, noiseTo: 120, noisePeak: 0.5, thudFrom: 110, thudTo: 38, thudPeak: 0.6 },
  boomMedium: { duration: 0.45, noiseFrom: 2200, noiseTo: 200, noisePeak: 0.4, thudFrom: 140, thudTo: 50, thudPeak: 0.5 },
  boomSmall: { duration: 0.3, noiseFrom: 3000, noiseTo: 300, noisePeak: 0.3, thudFrom: 190, thudTo: 70, thudPeak: 0.35 },
  boomTiny: { duration: 0.15, noiseFrom: 4000, noiseTo: 600, noisePeak: 0.2, thudFrom: 260, thudTo: 110, thudPeak: 0.2 },
};

/** A noise sweep (lowpass closing) with a sine drop under it. */
function boom(bed: VoiceBed, out: AudioNode, t: number, b: Boom): void {
  noiseBurst(bed, out, { filter: 'lowpass', from: b.noiseFrom, to: b.noiseTo, start: t, duration: b.duration, peak: b.noisePeak });
  tone(bed, out, { type: 'sine', from: b.thudFrom, to: b.thudTo, start: t, duration: b.duration, peak: b.thudPeak });
}

/** MIDI note numbers of the game-over triad, falling: E5, C5, A4. */
const GAME_OVER_NOTES = [76, 72, 69] as const;
const GAME_OVER_STEP = 0.24;

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

const SFX: Readonly<Record<SfxName, (bed: VoiceBed, out: AudioNode, t: number) => void>> = {
  shoot: (bed, out, t) => {
    tone(bed, out, { type: 'square', from: 880, to: 330, start: t, duration: 0.09, peak: 0.1 });
  },
  boomLarge: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomLarge);
  },
  boomMedium: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomMedium);
  },
  boomSmall: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomSmall);
  },
  boomTiny: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomTiny);
  },
  shipHit: (bed, out, t) => {
    boom(bed, out, t, { duration: 0.8, noiseFrom: 2400, noiseTo: 90, noisePeak: 0.6, thudFrom: 160, thudTo: 30, thudPeak: 0.7 });
    tone(bed, out, { type: 'sawtooth', from: 520, to: 60, start: t, duration: 0.5, peak: 0.2 });
  },
  gameOver: (bed, out, t) => {
    GAME_OVER_NOTES.forEach((midi, i) => {
      const hz = midiToHz(midi);
      const last = i === GAME_OVER_NOTES.length - 1;
      tone(bed, out, {
        type: 'triangle',
        from: hz,
        ...(last ? { to: hz * 0.8 } : {}),
        start: t + i * GAME_OVER_STEP,
        duration: last ? 0.9 : 0.5,
        peak: 0.25,
        attack: 0.01,
      });
    });
  },
  uiClick: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 660, to: 880, start: t, duration: 0.05, peak: 0.15 });
  },
  pause: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 520, to: 390, start: t, duration: 0.09, peak: 0.15 });
  },
};

/** Starts sound effect `name` now on `out`. */
export function playSfx(bed: VoiceBed, out: AudioNode, name: SfxName): void {
  SFX[name](bed, out, bed.ctx.currentTime);
}

const PAD_DETUNE_CENTS = 6;

const NOTE_VOICES: Readonly<Record<VoiceName, (bed: VoiceBed, out: AudioNode, note: NoteEvent) => void>> = {
  // A soft pluck: triangle with a fast attack that decays over the note.
  arp: (bed, out, { time, midi, duration, velocity }) => {
    tone(bed, out, { type: 'triangle', from: midiToHz(midi), start: time, duration: duration * 1.6, peak: velocity * 0.14, attack: 0.012 });
  },
  bass: (bed, out, { time, midi, duration, velocity }) => {
    tone(bed, out, { type: 'sine', from: midiToHz(midi), start: time, duration, peak: velocity * 0.3, attack: 0.03 });
  },
  // Two slightly detuned triangles with a slow swell.
  pad: (bed, out, { time, midi, duration, velocity }) => {
    for (const detune of [-PAD_DETUNE_CENTS, PAD_DETUNE_CENTS]) {
      tone(bed, out, { type: 'triangle', from: midiToHz(midi), start: time, duration, peak: velocity * 0.05, attack: duration * 0.35, detune });
    }
  },
  // A band of noise around 2 kHz, so it survives the music bus's 2.6 kHz lowpass.
  hat: (bed, out, { time, duration, velocity }) => {
    noiseBurst(bed, out, { filter: 'bandpass', from: 2000, q: 1.2, start: time, duration, peak: velocity * 0.07 });
  },
};

/** Starts `note` at its own time on `out`. */
export function playNote(bed: VoiceBed, out: AudioNode, note: NoteEvent): void {
  NOTE_VOICES[note.voice](bed, out, note);
}
