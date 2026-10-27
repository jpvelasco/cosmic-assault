import type { NoteEvent, VoiceName } from './sequencer';
import type { HumName, SfxName } from './sfx';

/** What every synthesized sound needs: the context to build nodes in and one shared buffer of noise. */
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
/** The galaxy's opening call, rising: C5, E5, G5. */
const GALAXY_START_NOTES = [72, 76, 79] as const;
/** The clear's fanfare, rising to the octave: C5, E5, G5, C6. */
const CLEARED_NOTES = [72, 76, 79, 84] as const;
/** The shower warning's two-tone alarm, twice: A5, E5. */
const STING_NOTES = [81, 76, 81, 76] as const;
/** A pickup dropping: a bright rising pair, G5 to D6. */
const DROP_NOTES = [79, 86] as const;
/** A pickup collected: a quick sparkle up the major chord, C6 E6 G6 C7. */
const COLLECT_NOTES = [84, 88, 91, 96] as const;
/** A timed effect running out: a soft falling pair, E6 to B5. */
const EFFECT_END_NOTES = [88, 83] as const;

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

interface Phrase {
  readonly type: OscillatorType;
  /** Seconds between note starts. */
  readonly step: number;
  readonly duration: number;
  /** The last note rings this long instead. */
  readonly lastDuration: number;
  readonly peak: number;
  /** The last note bends to this share of its pitch; omit to hold it. */
  readonly lastBend?: number;
}

/** `notes` one after another, `phrase.step` apart. */
function phrase(bed: VoiceBed, out: AudioNode, t: number, notes: readonly number[], p: Phrase): void {
  notes.forEach((midi, i) => {
    const hz = midiToHz(midi);
    const last = i === notes.length - 1;
    tone(bed, out, {
      type: p.type,
      from: hz,
      ...(last && p.lastBend !== undefined ? { to: hz * p.lastBend } : {}),
      start: t + i * p.step,
      duration: last ? p.lastDuration : p.duration,
      peak: p.peak,
      attack: 0.01,
    });
  });
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
    phrase(bed, out, t, GAME_OVER_NOTES, { type: 'triangle', step: 0.24, duration: 0.5, lastDuration: 0.9, peak: 0.25, lastBend: 0.8 });
  },
  uiClick: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 660, to: 880, start: t, duration: 0.05, peak: 0.15 });
  },
  pause: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 520, to: 390, start: t, duration: 0.09, peak: 0.15 });
  },
  galaxyStart: (bed, out, t) => {
    phrase(bed, out, t, GALAXY_START_NOTES, { type: 'triangle', step: 0.09, duration: 0.16, lastDuration: 0.4, peak: 0.18 });
  },
  showerSting: (bed, out, t) => {
    phrase(bed, out, t, STING_NOTES, { type: 'square', step: 0.13, duration: 0.11, lastDuration: 0.16, peak: 0.08 });
  },
  // The shower arriving: a soft rush of noise, rising and falling away.
  showerWhoosh: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'bandpass', from: 300, to: 2400, q: 0.7, start: t, duration: 0.8, peak: 0.08 });
  },
  // A rising whoosh: a sine climbing under a widening band of noise.
  warp: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 180, to: 1400, start: t, duration: 0.9, peak: 0.14, attack: 0.25 });
    noiseBurst(bed, out, { filter: 'bandpass', from: 500, to: 5000, q: 0.9, start: t, duration: 0.9, peak: 0.12 });
  },
  cleared: (bed, out, t) => {
    phrase(bed, out, t + 0.15, CLEARED_NOTES, { type: 'triangle', step: 0.11, duration: 0.22, lastDuration: 0.8, peak: 0.22 });
  },
  combo: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 880, to: 1320, start: t, duration: 0.07, peak: 0.12 });
    tone(bed, out, { type: 'triangle', from: 1760, start: t + 0.05, duration: 0.08, peak: 0.06 });
  },
  // A low swell as the boss arrives, over a distant rumble.
  bossIntro: (bed, out, t) => {
    tone(bed, out, { type: 'sawtooth', from: 55, to: 82, start: t, duration: 1.4, peak: 0.16, attack: 0.5 });
    noiseBurst(bed, out, { filter: 'lowpass', from: 400, to: 90, start: t, duration: 1.2, peak: 0.22 });
  },
  bossWindup: (bed, out, t) => {
    tone(bed, out, { type: 'sawtooth', from: 220, to: 660, start: t, duration: 0.4, peak: 0.07, attack: 0.08 });
  },
  bossPhase: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomMedium);
    tone(bed, out, { type: 'square', from: 660, to: 220, start: t, duration: 0.35, peak: 0.1 });
  },
  bossDown: (bed, out, t) => {
    boom(bed, out, t, { duration: 1.4, noiseFrom: 2000, noiseTo: 60, noisePeak: 0.6, thudFrom: 120, thudTo: 25, thudPeak: 0.7 });
    tone(bed, out, { type: 'sawtooth', from: 400, to: 40, start: t, duration: 1, peak: 0.16 });
  },
  pickupDrop: (bed, out, t) => {
    phrase(bed, out, t, DROP_NOTES, { type: 'sine', step: 0.07, duration: 0.09, lastDuration: 0.22, peak: 0.13 });
  },
  pickupCollect: (bed, out, t) => {
    phrase(bed, out, t, COLLECT_NOTES, { type: 'triangle', step: 0.045, duration: 0.08, lastDuration: 0.3, peak: 0.14 });
    tone(bed, out, { type: 'sine', from: 2093, start: t + 0.14, duration: 0.25, peak: 0.04 });
  },
  // A soft bloop falling away: a pickup left uncollected.
  pickupExpire: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 700, to: 230, start: t, duration: 0.28, peak: 0.09, attack: 0.01 });
  },
  effectEnd: (bed, out, t) => {
    phrase(bed, out, t, EFFECT_END_NOTES, { type: 'triangle', step: 0.08, duration: 0.1, lastDuration: 0.22, peak: 0.08, lastBend: 0.94 });
  },
  // Glass shattering: a bright band of noise over a metallic ping dropping away, and a soft thud under them.
  shieldBreak: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'highpass', from: 5000, to: 1800, q: 0.9, start: t, duration: 0.4, peak: 0.22 });
    tone(bed, out, { type: 'triangle', from: 1900, to: 520, start: t, duration: 0.32, peak: 0.12 });
    tone(bed, out, { type: 'sine', from: 180, to: 70, start: t, duration: 0.25, peak: 0.25 });
  },
  // A swarm arriving: two detuned buzzes beating against each other as they rise.
  droneSwarm: (bed, out, t) => {
    for (const detune of [-18, 18]) {
      tone(bed, out, { type: 'sawtooth', from: 150, to: 210, start: t, duration: 0.55, peak: 0.035, attack: 0.12, detune });
    }
  },
  // A rock cracking without breaking: a sharp click of noise over a short knock.
  foeCrack: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'bandpass', from: 2600, to: 900, q: 1.4, start: t, duration: 0.09, peak: 0.25 });
    tone(bed, out, { type: 'triangle', from: 320, to: 160, start: t, duration: 0.1, peak: 0.16 });
  },
  // A rock breaking in three: a medium boom with a crack on top.
  splitterBreak: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomMedium);
    noiseBurst(bed, out, { filter: 'highpass', from: 3600, to: 1500, start: t, duration: 0.14, peak: 0.16 });
  },
  // A drone going down: a small boom and an electric zap falling away.
  droneDown: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomSmall);
    tone(bed, out, { type: 'square', from: 1100, to: 140, start: t, duration: 0.2, peak: 0.06 });
  },
  // A well forming: two deep falling throbs.
  wellWarn: (bed, out, t) => {
    for (const start of [t, t + 0.42]) tone(bed, out, { type: 'sine', from: 230, to: 95, start, duration: 0.36, peak: 0.2, attack: 0.04 });
  },
  // The well opening: a deep sweep down into a low rumble, under which its hum takes over.
  wellOpen: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 180, to: 46, start: t, duration: 1, peak: 0.24, attack: 0.05 });
    noiseBurst(bed, out, { filter: 'lowpass', from: 600, to: 80, start: t, duration: 0.9, peak: 0.16 });
  },
  // The well letting go: a short rise, released.
  wellClose: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 50, to: 170, start: t, duration: 0.5, peak: 0.16, attack: 0.05 });
  },
  // A shot glancing off a shielded core: a dry metallic tick, quiet, as held fire makes many.
  deflect: (bed, out, t) => {
    tone(bed, out, { type: 'triangle', from: 2600, to: 1900, start: t, duration: 0.05, peak: 0.05 });
  },
  // A boss's part cracking: a heavy stone knock, lower than a foe's crack.
  partCrack: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'bandpass', from: 1500, to: 600, q: 1.2, start: t, duration: 0.1, peak: 0.24 });
    tone(bed, out, { type: 'triangle', from: 200, to: 110, start: t, duration: 0.12, peak: 0.18 });
  },
  // A boss's part breaking off: a small boom under a gravelly crunch.
  partBreak: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomSmall);
    noiseBurst(bed, out, { filter: 'bandpass', from: 1200, to: 300, q: 0.8, start: t, duration: 0.3, peak: 0.2 });
  },
  // The core laid bare: a bright fifth swelling upward over a shimmer.
  coreExposed: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 330, to: 660, start: t, duration: 0.6, peak: 0.14, attack: 0.08 });
    tone(bed, out, { type: 'triangle', from: 495, to: 990, start: t + 0.04, duration: 0.6, peak: 0.08, attack: 0.08 });
    noiseBurst(bed, out, { filter: 'highpass', from: 4000, to: 7000, start: t, duration: 0.5, peak: 0.05 });
  },
  // The core shielded again: a shutter falling closed onto a low thud.
  coreShielded: (bed, out, t) => {
    tone(bed, out, { type: 'square', from: 520, to: 200, start: t, duration: 0.28, peak: 0.07 });
    tone(bed, out, { type: 'sine', from: 140, to: 60, start: t + 0.2, duration: 0.25, peak: 0.22 });
  },
  // A hangar opening: a hydraulic hiss under a servo whine climbing as the doors part.
  hangarOpen: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'highpass', from: 1800, to: 5200, start: t, duration: 0.4, peak: 0.08 });
    tone(bed, out, { type: 'sawtooth', from: 160, to: 420, start: t, duration: 0.42, peak: 0.05, attack: 0.05 });
  },
  // A hangar closing: the servo winding down onto a heavy latch.
  hangarClose: (bed, out, t) => {
    tone(bed, out, { type: 'sawtooth', from: 380, to: 150, start: t, duration: 0.3, peak: 0.05 });
    noiseBurst(bed, out, { filter: 'lowpass', from: 900, to: 200, start: t + 0.26, duration: 0.12, peak: 0.2 });
    tone(bed, out, { type: 'sine', from: 110, to: 55, start: t + 0.26, duration: 0.18, peak: 0.2 });
  },
  // A gunship winding up: two quick rising ticks, a charge coming.
  windupTick: (bed, out, t) => {
    for (const start of [t, t + 0.14]) tone(bed, out, { type: 'square', from: 880, to: 1500, start, duration: 0.06, peak: 0.045 });
  },
  // A hostile bolt fired: a short falling zap over a hiss.
  bolt: (bed, out, t) => {
    tone(bed, out, { type: 'sawtooth', from: 1500, to: 280, start: t, duration: 0.13, peak: 0.05 });
    noiseBurst(bed, out, { filter: 'highpass', from: 3500, to: 2000, start: t, duration: 0.06, peak: 0.06 });
  },
  // A mine arming: three high alarm beeps, quickening.
  mineArm: (bed, out, t) => {
    for (const start of [t, t + 0.16, t + 0.28]) tone(bed, out, { type: 'sine', from: 1320, start, duration: 0.07, peak: 0.09 });
  },
  // A mine going off: a medium boom with a crackling burst on top.
  mineBlast: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomMedium);
    noiseBurst(bed, out, { filter: 'bandpass', from: 2400, to: 500, q: 0.9, start: t, duration: 0.35, peak: 0.22 });
  },
  // A danger zone forming: a falling two-note warble.
  zoneWarn: (bed, out, t) => {
    for (const start of [t, t + 0.3]) tone(bed, out, { type: 'triangle', from: 760, to: 520, start, duration: 0.26, peak: 0.1, attack: 0.02 });
  },
  // A gunship going down: a medium boom and a heavy zap falling away.
  gunshipDown: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomMedium);
    tone(bed, out, { type: 'square', from: 700, to: 90, start: t, duration: 0.3, peak: 0.06 });
  },
  // A mine shot down before it could blast: a small boom and a bright ping.
  mineDown: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomSmall);
    tone(bed, out, { type: 'triangle', from: 1800, to: 1200, start: t, duration: 0.12, peak: 0.07 });
  },
  // A boss's bolt: a short falling zap over a hiss, quiet, since a volley fires a dozen at once.
  bossBolt: (bed, out, t) => {
    tone(bed, out, { type: 'square', from: 1100, to: 280, start: t, duration: 0.09, peak: 0.045 });
    noiseBurst(bed, out, { filter: 'highpass', from: 3000, to: 1500, start: t, duration: 0.06, peak: 0.05 });
  },
  // A shot turned aside by armour: a short bright clink, higher than a boss's shield tick.
  armourDeflect: (bed, out, t) => {
    tone(bed, out, { type: 'triangle', from: 2200, to: 1500, start: t, duration: 0.08, peak: 0.07 });
    tone(bed, out, { type: 'sine', from: 3300, to: 3000, start: t, duration: 0.05, peak: 0.03 });
  },
  // A phaser charging: two quick rising chirps, bright and unsteady.
  phaserWarn: (bed, out, t) => {
    for (const start of [t, t + 0.22]) tone(bed, out, { type: 'triangle', from: 900, to: 1400, start, duration: 0.18, peak: 0.08, attack: 0.02 });
  },
  // A phaser blinking: a bright ping that drops away into a short zap.
  phaserBlink: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 1700, to: 600, start: t, duration: 0.12, peak: 0.1 });
    noiseBurst(bed, out, { filter: 'highpass', from: 4000, to: 2500, start: t, duration: 0.05, peak: 0.05 });
  },
  // A warp rift forming: a low wavering throb, rising as it settles.
  riftWarn: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 180, to: 260, start: t, duration: 0.45, peak: 0.14, attack: 0.1 });
    noiseBurst(bed, out, { filter: 'bandpass', from: 800, to: 1600, q: 1.5, start: t, duration: 0.45, peak: 0.05 });
  },
  // A warp rift opening: a whoosh of air as the mouths part.
  riftOpen: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'bandpass', from: 400, to: 2600, q: 1, start: t, duration: 0.5, peak: 0.12 });
    tone(bed, out, { type: 'sine', from: 300, to: 900, start: t, duration: 0.5, peak: 0.08, attack: 0.05 });
  },
  // A body passing through a rift: a quick swoosh, falling.
  riftJump: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'bandpass', from: 2600, to: 500, q: 0.9, start: t, duration: 0.22, peak: 0.14 });
    tone(bed, out, { type: 'triangle', from: 1200, to: 300, start: t, duration: 0.2, peak: 0.08 });
  },
  // A warp rift closing: the whoosh drawn back and a soft thud.
  riftClose: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 900, to: 200, start: t, duration: 0.4, peak: 0.1 });
    noiseBurst(bed, out, { filter: 'lowpass', from: 1200, to: 300, start: t + 0.3, duration: 0.12, peak: 0.12 });
  },
  // A repulsion field forming: a low note pushed out, then back, as a ripple.
  repulseWarn: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 360, to: 180, start: t, duration: 0.3, peak: 0.1, attack: 0.02 });
    tone(bed, out, { type: 'sine', from: 180, to: 360, start: t + 0.3, duration: 0.3, peak: 0.1 });
  },
  // A repulsion field pushing out: a broad outward whoomp.
  repulseOpen: (bed, out, t) => {
    noiseBurst(bed, out, { filter: 'bandpass', from: 200, to: 900, q: 0.8, start: t, duration: 0.5, peak: 0.14 });
    tone(bed, out, { type: 'sine', from: 90, to: 220, start: t, duration: 0.5, peak: 0.14, attack: 0.05 });
  },
  // A repulsion field going: the push falling away.
  repulseClose: (bed, out, t) => {
    tone(bed, out, { type: 'sine', from: 220, to: 60, start: t, duration: 0.35, peak: 0.12 });
  },
  // A Field Bomb or a Nova going off: a large boom under a rushing crackle.
  blast: (bed, out, t) => {
    boom(bed, out, t, BOOMS.boomLarge);
    noiseBurst(bed, out, { filter: 'bandpass', from: 1600, to: 200, q: 0.8, start: t, duration: 0.5, peak: 0.2 });
  },
};

/** A sound that plays until it is stopped. */
export interface Loop {
  /** Fades it out from now and stops it once silent; its nodes disconnect themselves when they end. */
  stop(): void;
}

/** Seconds a hum's fade out takes; its oscillators stop a tail after that, once it is silent. */
const HUM_RELEASE = 0.3;

/** A looped hum: two voices under a slow swell in their level. */
interface HumVoice {
  readonly peak: number;
  readonly fadeIn: number;
  readonly low: readonly [OscillatorType, number];
  /** The upper voice, and its detune in cents. */
  readonly high: readonly [OscillatorType, number, number];
  /** Hz, and the share of the peak it swells by. */
  readonly swell: number;
  readonly swellDepth: number;
}

const HUM_VOICES: Readonly<Record<HumName, HumVoice>> = {
  // The well: a low sine and a detuned triangle a fifth above, swelling slowly.
  well: { peak: 0.09, fadeIn: 0.8, low: ['sine', 49], high: ['triangle', 73.5, 7], swell: 0.6, swellDepth: 0.4 },
  // The zone: an electric buzz, a sawtooth and a detuned square a fifth above, throbbing fast.
  zone: { peak: 0.035, fadeIn: 0.25, low: ['sawtooth', 110], high: ['square', 165, -9], swell: 4, swellDepth: 0.35 },
};

/**
 * Hum `name` (see `HUM_VOICES`), looped until `stop`. It fades in from silence; `stop` ramps both its level and its
 * swell to 0 from wherever they are, on the audio clock, and stops the oscillators only after that, so it ends without
 * a step.
 */
export function startHum({ ctx }: VoiceBed, out: AudioNode, name: HumName): Loop {
  const voice = HUM_VOICES[name];
  const t = ctx.currentTime;
  const level = ctx.createGain();
  level.gain.setValueAtTime(SILENCE, t);
  level.gain.linearRampToValueAtTime(voice.peak, t + voice.fadeIn);
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = voice.peak * voice.swellDepth;
  const oscillator = (type: OscillatorType, hz: number, detune = 0): OscillatorNode => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    osc.detune.value = detune;
    osc.start(t);
    return osc;
  };
  const low = oscillator(...voice.low);
  const high = oscillator(...voice.high);
  const swell = oscillator('sine', voice.swell);
  const voices = [low, high, swell];
  low.connect(level);
  high.connect(level);
  swell.connect(swellDepth).connect(level.gain);
  level.connect(out);
  low.onended = () => {
    for (const node of [...voices, swellDepth, level]) node.disconnect();
  };
  return {
    stop() {
      const now = ctx.currentTime;
      // Held at the value it has now (mid fade-in, too), then ramped down; the swell must reach 0 as well, since it
      // adds to the level.
      for (const param of [level.gain, swellDepth.gain]) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(0, now + HUM_RELEASE);
      }
      for (const osc of voices) osc.stop(now + HUM_RELEASE + TAIL);
    },
  };
}

/** Starts sound effect `name` on `out`, `delay` seconds from now on the audio clock. */
export function playSfx(bed: VoiceBed, out: AudioNode, name: SfxName, delay = 0): void {
  SFX[name](bed, out, bed.ctx.currentTime + delay);
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
