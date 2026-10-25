import { describe, expect, it } from 'vitest';
import { LOOKAHEAD_SECONDS, scheduleWindow, type NoteEvent, type Pattern } from '../../src/audio/sequencer';

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
