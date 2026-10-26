import { describe, expect, it } from 'vitest';
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
      const out = stepTimeline(line, now >= switchAt && line.pattern !== NEW.pattern ? NEW : null, START + now + LOOKAHEAD_SECONDS);
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
      const out = stepTimeline(line, null, START + now + LOOKAHEAD_SECONDS);
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
    const out = stepTimeline(first(), NEW, START + 0.1);
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
      const out = stepTimeline(line, NEW, START + now + LOOKAHEAD_SECONDS);
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
