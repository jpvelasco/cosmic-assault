import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng';
import { BEATS_PER_BAR, LOOKAHEAD_SECONDS, scheduleWindow, stepTimeline, type NoteEvent, type Pattern, type Timeline } from '../../src/audio/sequencer';

/** Two-beat pattern, so a loop boundary comes every 2 beats (1 s at 120 bpm). */
const PATTERN: Pattern = {
  lengthBeats: 2,
  notes: [
    { beat: 0, voice: 'bass', midi: 40, duration: 1, velocity: 0.8 },
    { beat: 1.5, voice: 'arp', midi: 64, duration: 0.5, velocity: 0.5 },
  ],
};
const BPM = 120; // 0.5 s per beat
const START = 10;

/** Runs the scheduler like the 25 ms timer does, from audio time 0 up to `until` seconds, and returns everything scheduled. */
function run(until: number, startBeat = 0): { events: NoteEvent[]; nextBeat: number } {
  const events: NoteEvent[] = [];
  let beat = startBeat;
  for (let now = startBeat * 0.5; now <= until; now += 0.025) {
    const out = scheduleWindow(PATTERN, BPM, beat, START + now + LOOKAHEAD_SECONDS, START);
    events.push(...out.events);
    beat = out.nextBeat;
  }
  return { events, nextBeat: beat };
}

describe('scheduleWindow', () => {
  it('places notes at startTime plus beats at the tempo, with durations in seconds', () => {
    const { events } = run(0.85);
    expect(events).toEqual([
      { time: 10, voice: 'bass', midi: 40, duration: 0.5, velocity: 0.8 },
      { time: 10.75, voice: 'arp', midi: 64, duration: 0.25, velocity: 0.5 },
    ]);
  });

  it('is deterministic', () => {
    expect(run(3)).toEqual(run(3));
    const a = scheduleWindow(PATTERN, BPM, 0.3, START + 0.1, START);
    expect(scheduleWindow(PATTERN, BPM, 0.3, START + 0.1, START)).toEqual(a);
  });

  it('wraps across the loop boundary with the right absolute times', () => {
    const times = run(2.6).events.map((e) => [e.voice, e.time]);
    expect(times).toEqual([
      ['bass', 10],
      ['arp', 10.75],
      ['bass', 11],
      ['arp', 11.75],
      ['bass', 12],
    ]);
  });

  it('schedules each note exactly once across consecutive windows', () => {
    const times = run(5).events.map((e) => e.time);
    // 5 s + 0.1 look-ahead covers beats 0 .. 10.2: bass at 0,2,..,10 and arp at 1.5,3.5,..,9.5.
    expect(times).toHaveLength(6 + 5);
    expect(new Set(times).size).toBe(times.length);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('puts a note that sits exactly on a window edge in the later window', () => {
    // Windows end at beat 2 (11 s): the bass at beat 2 belongs to the next one.
    const first = scheduleWindow(PATTERN, BPM, 1.8, START + 1, START);
    expect(first.events).toEqual([]);
    expect(first.nextBeat).toBe(2);
    const second = scheduleWindow(PATTERN, BPM, first.nextBeat, START + 1.1, START);
    expect(second.events.map((e) => e.time)).toEqual([11]);
  });

  it('jumps to now after a stall of more than one look-ahead instead of flooding old notes', () => {
    // 60 s late: replaying from beat 0 would emit dozens of notes at once.
    const now = START + 60;
    const { events, nextBeat } = scheduleWindow(PATTERN, BPM, 0, now + LOOKAHEAD_SECONDS, START);
    expect(events).toHaveLength(1);
    for (const e of events) expect(e.time).toBeGreaterThanOrEqual(now);
    expect(nextBeat).toBeCloseTo((60 + LOOKAHEAD_SECONDS) * 2, 8);
  });

  it('does not skip when late by less than one look-ahead', () => {
    const now = START + 1.05;
    const out = scheduleWindow(PATTERN, BPM, 2, now + LOOKAHEAD_SECONDS, START); // from 11 s, 0.05 s behind
    expect(out.events[0]?.time).toBe(11);
  });

  it('skips once the next beat is more than one look-ahead behind now', () => {
    const now = START + 1.05;
    const out = scheduleWindow(PATTERN, BPM, 1.8, now + LOOKAHEAD_SECONDS, START); // from 10.9 s, 0.15 s behind
    expect(out.events).toEqual([]);
    expect(out.nextBeat).toBeCloseTo((1.05 + LOOKAHEAD_SECONDS) * 2, 10);
  });

  it('returns nothing and keeps the beat when time has not advanced', () => {
    const out = scheduleWindow(PATTERN, BPM, 3, START + 1.4, START); // toBeat 2.8 < from
    expect(out).toEqual({ events: [], nextBeat: 3 });
  });
});

describe('stepTimeline', () => {
  /** One bar of two notes, at 120 bpm (0.5 s a beat): a bar is 2 s, so bar lines fall at START + 2n. */
  const bar = (voice: 'bass' | 'arp', midi: number): Pattern => ({
    lengthBeats: BEATS_PER_BAR,
    notes: [
      { beat: 0, voice, midi, duration: 1, velocity: 0.8 },
      { beat: 2.5, voice, midi: midi + 7, duration: 0.5, velocity: 0.5 },
    ],
  });
  const OLD = { pattern: bar('bass', 40), bpm: 120 };
  /** Faster, so its seconds per beat differ from the old theme's: 0.4 s a beat. */
  const NEW = { pattern: bar('arp', 60), bpm: 150 };
  const first = (): Timeline => ({ ...OLD, startTime: START, nextBeat: 0 });

  /** Runs the 25 ms timer from audio time `from` to `until` (seconds after START), asking for NEW from `switchAt`. */
  function run(switchAt: number, until: number, from = 0): { events: NoteEvent[]; line: Timeline; switchedAt: number[] } {
    let line = first();
    const events: NoteEvent[] = [];
    const switchedAt: number[] = [];
    for (let now = from; now <= until; now += 0.025) {
      const out = stepTimeline(line, now >= switchAt && line.pattern !== NEW.pattern ? NEW : null, START + now + LOOKAHEAD_SECONDS, 'bar');
      events.push(...out.events);
      line = out.line;
      if (out.switchedAt !== null) switchedAt.push(out.switchedAt);
    }
    return { events, line, switchedAt };
  }

  it('plays the old theme on, untouched, while nothing is requested', () => {
    let line = first();
    const times: number[] = [];
    for (let now = 0; now <= 4.2; now += 0.025) {
      const out = stepTimeline(line, null, START + now + LOOKAHEAD_SECONDS, 'bar');
      expect(out.switchedAt).toBeNull();
      times.push(...out.events.map((e) => e.time));
      line = out.line;
    }
    expect(times).toEqual([10, 11.25, 12, 13.25, 14]);
  });

  it('puts the switch on the next bar line, with the old theme before it and the new one from it', () => {
    // Asked 0.7 s into the first bar: its notes finish, and the new theme starts at the bar line 2 s in.
    const { events, switchedAt } = run(0.7, 5);
    expect(switchedAt).toEqual([START + 2]);
    expect(events.map((e) => [e.voice, Math.round(e.time * 1e6) / 1e6])).toEqual([
      ['bass', 10],
      ['bass', 11.25],
      ['arp', 12],
      ['arp', 13],
      ['arp', 13.6],
      ['arp', 14.6],
    ]);
  });

  it('never lets an old note start at or after the switch, or a new one before it', () => {
    for (const askedAt of [0.1, 0.9, 1.4, 2.0, 2.3, 3.1, 3.9]) {
      const { events, switchedAt } = run(askedAt, 8);
      const [at] = switchedAt;
      expect(switchedAt).toHaveLength(1);
      const bars = ((at as number) - START) / (BEATS_PER_BAR * 0.5);
      expect(bars).toBeCloseTo(Math.round(bars), 9);
      for (const e of events) expect(e.voice === 'bass' ? e.time < (at as number) : e.time >= (at as number), `asked at ${String(askedAt)}`).toBe(true);
    }
  });

  it('counts the new theme\'s beats from the switch, at its own tempo', () => {
    const { line, switchedAt } = run(0.5, 6);
    expect(line.pattern).toBe(NEW.pattern);
    expect(line.bpm).toBe(150);
    expect(line.startTime).toBe(switchedAt[0]);
  });

  it('switches at once when asked exactly on a bar line that has not been scheduled', () => {
    const out = stepTimeline(first(), NEW, START + 0.1, 'bar');
    expect(out.switchedAt).toBe(START);
    expect(out.events.map((e) => e.voice)).toEqual(['arp']);
    expect(out.events[0]?.time).toBe(START);
  });

  it('switches once however long it waits, and then plays the new theme on without switching again', () => {
    const { switchedAt, events } = run(0.3, 12);
    expect(switchedAt).toHaveLength(1);
    expect(events.filter((e) => e.voice === 'arp').length).toBeGreaterThan(4);
  });

  it('after a stall switches at the first bar line past now, never replaying old notes', () => {
    // 60 s late: the next bar line after now is 62 s in (they fall every 2 s), and nothing from before now plays.
    let line = first();
    const events: NoteEvent[] = [];
    const switches: number[] = [];
    for (let now = 60.3; now <= 62.5; now += 0.025) {
      const out = stepTimeline(line, NEW, START + now + LOOKAHEAD_SECONDS, 'bar');
      events.push(...out.events);
      line = out.line;
      if (out.switchedAt !== null) switches.push(out.switchedAt);
    }
    expect(switches).toEqual([START + 62]);
    for (const e of events) expect(e.time).toBeGreaterThanOrEqual(START + 60.3);
    expect(events.map((e) => e.voice)).toEqual(['bass', 'arp']);
  });

  it('is deterministic', () => {
    expect(run(0.7, 5)).toEqual(run(0.7, 5));
  });
});

describe('stepTimeline at tempos that do not divide a second', () => {
  /** A note on beat 0 of every bar and one on every beat, as the old theme; the new theme has a note on beat 0 too. */
  const everyBeat = (voice: 'bass' | 'arp'): Pattern => ({
    lengthBeats: 2 * BEATS_PER_BAR,
    notes: Array.from({ length: 2 * BEATS_PER_BAR }, (_, beat) => ({ beat, voice, midi: 40, duration: 0.5, velocity: 0.5 })),
  });
  const OLD_PATTERN = everyBeat('bass');
  const NEW_PATTERN = everyBeat('arp');

  /**
   * Starts `bpm` at audio time `startTime` with its next beat at `fromBeat`, asks for the other theme at once and ticks
   * every 25 ms until it switches; returns the events and the switch time.
   */
  function switchOnce(bpm: number, startTime: number, fromBeat: number, grain: 'bar' | 'beat', nextBpm: number) {
    let line: Timeline = { pattern: OLD_PATTERN, bpm, startTime, nextBeat: fromBeat };
    const events: NoteEvent[] = [];
    const from = startTime + (fromBeat * 60) / bpm;
    for (let now = from; now < from + 60; now += 0.025) {
      const out = stepTimeline(line, { pattern: NEW_PATTERN, bpm: nextBpm }, now + LOOKAHEAD_SECONDS, grain);
      events.push(...out.events);
      line = out.line;
      if (out.switchedAt !== null) return { events, switchedAt: out.switchedAt, line, asked: now };
    }
    throw new Error('the theme never switched');
  }

  it('keeps the old theme\'s downbeat off the new lane at 110 bpm from a large, non-dyadic audio time', () => {
    for (let bar = 0; bar < 400; bar++) {
      const { events, switchedAt } = switchOnce(110, 1234.567 + bar * 0.0137, bar * 0.3, 'bar', 126);
      for (const e of events) expect(e.voice === 'bass' ? e.time < switchedAt : e.time >= switchedAt, `bar ${String(bar)} ${e.voice} at ${String(e.time - switchedAt)}`).toBe(true);
    }
  });

  it('never puts an old note at or after the switch, nor a new one before it, over 10,000 random switches at 96 to 126 bpm', () => {
    const rng = createRng(0x5eed);
    for (let i = 0; i < 10_000; i++) {
      const bpm = rng.int(96, 127);
      const grain = rng.chance(0.5) ? 'bar' : 'beat';
      const { events, switchedAt, line } = switchOnce(bpm, rng.range(0, 5000), rng.range(0, 8), grain, rng.int(96, 127));
      for (const e of events) {
        if (e.voice === 'bass') expect(e.time, `${String(bpm)} bpm, ${grain}`).toBeLessThan(switchedAt);
        else expect(e.time, `${String(bpm)} bpm, ${grain}`).toBeGreaterThanOrEqual(switchedAt);
      }
      expect(line.startTime).toBe(switchedAt);
    }
  });
});

describe('stepTimeline switch granularity', () => {
  const pattern: Pattern = { lengthBeats: BEATS_PER_BAR, notes: [{ beat: 0, voice: 'bass', midi: 40, duration: 1, velocity: 0.8 }] };
  const next = { pattern: { ...pattern, notes: [{ beat: 0, voice: 'arp' as const, midi: 60, duration: 1, velocity: 0.8 }] }, bpm: 96 };

  /** Ticks a 96 bpm (0.625 s a beat) timeline from audio time 0 until the switch, asking for `next` at `askedAt`. */
  function switchTime(grain: 'bar' | 'beat', askedAt: number, bpm: number): number {
    let line: Timeline = { pattern, bpm, startTime: 0, nextBeat: 0 };
    for (let now = 0; now < 30; now += 0.025) {
      const out = stepTimeline(line, now >= askedAt ? next : null, now + LOOKAHEAD_SECONDS, grain);
      line = out.line;
      if (out.switchedAt !== null) return out.switchedAt;
    }
    throw new Error('the theme never switched');
  }

  it('lands a beat switch on a beat line, within one beat of being asked', () => {
    const spb = 60 / 96;
    for (const askedAt of [0.3, 0.7, 1.4, 2.2, 3.9]) {
      const at = switchTime('beat', askedAt, 96);
      expect((at / spb) % 1 < 1e-9 || (at / spb) % 1 > 1 - 1e-9, `asked at ${String(askedAt)}`).toBe(true);
      expect(at).toBeGreaterThanOrEqual(askedAt);
      expect(at - askedAt).toBeLessThanOrEqual(spb + LOOKAHEAD_SECONDS + 0.025);
    }
  });

  it('lands a bar switch on a bar line, which can be nearly a bar away', () => {
    const bar = (60 / 96) * BEATS_PER_BAR;
    const at = switchTime('bar', 0.3, 96);
    expect(at / bar).toBeCloseTo(Math.round(at / bar), 9);
    expect(at - 0.3).toBeGreaterThan(60 / 96);
  });

  it.each([96, 110])('switches within 2 s at %d bpm with a beat switch, the length of the boss intro', (bpm) => {
    for (let askedAt = 0.1; askedAt < 6; askedAt += 0.173) expect(switchTime('beat', askedAt, bpm) - askedAt).toBeLessThanOrEqual(2);
  });
});
