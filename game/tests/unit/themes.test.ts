import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GALAXIES } from '../../src/content/galaxies';
import { bossThemeOf, patternOf, THEME_IDS, THEMES, type MusicTheme } from '../../src/audio/themes';
import { BEATS_PER_BAR, type PatternNote } from '../../src/audio/sequencer';

const ALL = THEME_IDS.map((id) => THEMES[id]);
const barOf = (note: PatternNote): number => Math.floor(note.beat / BEATS_PER_BAR);
const pitched = (notes: readonly PatternNote[]): PatternNote[] => notes.filter((n) => n.voice !== 'hat');
const inKey = (theme: MusicTheme, midi: number): boolean => theme.key.scale.includes((((midi - theme.key.tonic) % 12) + 12) % 12);
const notesOf = (theme: MusicTheme, voice: PatternNote['voice']): PatternNote[] => patternOf(theme).notes.filter((n) => n.voice === voice);

describe('the theme table', () => {
  it('holds a theme and a boss variant for each music theme, keyed by its own id', () => {
    const bases = ['drift', 'ionReach', 'crimsonNebula', 'voidRift', 'singularity'] as const;
    expect([...THEME_IDS].sort()).toEqual([...bases, ...bases.map((id) => `${id}Boss`)].sort());
    for (const id of THEME_IDS) expect(THEMES[id].id).toBe(id);
  });

  it('resolves the theme of every galaxy, and a boss variant of it', () => {
    for (const g of GALAXIES) {
      expect(THEME_IDS, g.id).toContain(g.theme);
      expect(THEME_IDS, g.id).toContain(bossThemeOf(g.theme));
    }
    expect(bossThemeOf('drift')).toBe('driftBoss');
    expect(bossThemeOf('ionReach')).toBe('ionReachBoss');
    expect(bossThemeOf('singularity')).toBe('singularityBoss');
  });
});

describe.each(ALL)('theme $id', (theme) => {
  const { notes, lengthBeats } = patternOf(theme);

  it('loops whole bars, one per chord', () => {
    expect(theme.chords).toHaveLength(4);
    expect(lengthBeats).toBe(theme.chords.length * BEATS_PER_BAR);
  });

  it('keeps a valid key: seven distinct degrees from the tonic inside one octave', () => {
    expect(theme.key.tonic).toBeGreaterThanOrEqual(0);
    expect(theme.key.tonic).toBeLessThan(12);
    expect(theme.key.scale).toHaveLength(7);
    expect(new Set(theme.key.scale).size).toBe(7);
    expect(theme.key.scale[0]).toBe(0);
    expect([...theme.key.scale]).toEqual([...theme.key.scale].sort((a, b) => a - b));
    expect(Math.max(...theme.key.scale)).toBeLessThan(12);
  });

  it('builds its chords from scale notes', () => {
    for (const chord of theme.chords) for (const midi of [chord.bass, ...chord.tones]) expect(inKey(theme, midi), String(midi)).toBe(true);
  });

  it('plays only scale notes, in a range the voices can sound', () => {
    for (const note of pitched(notes)) {
      expect(inKey(theme, note.midi), `${note.voice} ${String(note.midi)}`).toBe(true);
      expect(note.midi).toBeGreaterThanOrEqual(28);
      expect(note.midi).toBeLessThanOrEqual(96);
    }
  });

  it('starts every note, and ends it, inside its own bar', () => {
    for (const note of notes) {
      expect(note.beat).toBeGreaterThanOrEqual(0);
      expect(note.duration).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
      const end = (barOf(note) + 1) * BEATS_PER_BAR;
      expect(note.beat + note.duration, `${note.voice} at ${String(note.beat)}`).toBeLessThanOrEqual(end + 1e-9);
      expect(barOf(note)).toBeLessThan(theme.chords.length);
    }
  });

  it('fills each bar with an arpeggio that spans it, a pad that holds it and some bass and hats', () => {
    for (let bar = 0; bar < theme.chords.length; bar++) {
      const inBar = notes.filter((n) => barOf(n) === bar);
      const arp = inBar.filter((n) => n.voice === 'arp');
      expect(arp.length * (arp[0]?.duration ?? 0)).toBeCloseTo(BEATS_PER_BAR, 9);
      expect(inBar.filter((n) => n.voice === 'pad').map((n) => n.duration)).toEqual([BEATS_PER_BAR, BEATS_PER_BAR, BEATS_PER_BAR]);
      expect(inBar.filter((n) => n.voice === 'bass').length).toBeGreaterThan(0);
      expect(inBar.filter((n) => n.voice === 'hat').length).toBeGreaterThan(0);
    }
  });

  it('puts the chord of each bar under its notes: the bass root and the pad tones', () => {
    theme.chords.forEach((chord, bar) => {
      const inBar = notes.filter((n) => barOf(n) === bar);
      expect(inBar.filter((n) => n.voice === 'pad').map((n) => n.midi)).toEqual([...chord.tones]);
      expect(inBar.find((n) => n.voice === 'bass')?.midi).toBe(chord.bass);
    });
  });

  it('builds the pattern once', () => {
    expect(patternOf(theme)).toBe(patternOf(theme));
  });
});

describe('Drift', () => {
  it('is the calm Am F C G loop at 96 bpm it has always been', () => {
    const drift = THEMES.drift;
    expect(drift.bpm).toBe(96);
    expect(drift.chords.map((c) => c.bass)).toEqual([45, 41, 48, 43]);
    // Not a parity trace: the old Drift loop, captured from the code before themes became data.
    const saved = JSON.parse(readFileSync(new URL('../fixtures/drift-pattern.json', import.meta.url), 'utf8')) as unknown;
    expect(patternOf(drift)).toEqual(saved);
  });
});

describe('Ion Reach', () => {
  const ion = THEMES.ionReach;
  const drift = THEMES.drift;
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

  it('is brisker than the Drift, at 108 to 112 bpm', () => {
    expect(ion.bpm).toBeGreaterThanOrEqual(108);
    expect(ion.bpm).toBeLessThanOrEqual(112);
  });

  it('has a brighter arpeggio: faster steps, higher notes', () => {
    const [ionFirst, driftFirst] = [notesOf(ion, 'arp')[0], notesOf(drift, 'arp')[0]];
    expect(ionFirst?.duration).toBeLessThan(driftFirst?.duration ?? 0);
    expect(mean(notesOf(ion, 'arp').map((n) => n.midi))).toBeGreaterThan(mean(notesOf(drift, 'arp').map((n) => n.midi)));
  });

  it('is in another key than the Drift', () => {
    expect(ion.key.tonic).not.toBe(drift.key.tonic);
    expect(ion.key.scale).not.toEqual(drift.key.scale);
  });
});

const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const PHRYGIAN_DOMINANT = [0, 1, 4, 5, 7, 8, 10];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

describe('Crimson Nebula', () => {
  const theme = THEMES.crimsonNebula;

  it('is a tense minor-feel loop around 116 bpm in D Phrygian dominant', () => {
    expect(theme.bpm).toBe(116);
    expect(theme.key).toEqual({ tonic: 2, scale: PHRYGIAN_DOMINANT });
  });

  it('pulses in eighth notes over a driving bass', () => {
    expect(notesOf(theme, 'arp')[0]?.duration).toBe(0.5);
    expect(notesOf(theme, 'bass').length).toBeGreaterThan(notesOf(THEMES.drift, 'bass').length);
  });
});

describe('Void Rift', () => {
  const theme = THEMES.voidRift;
  const span = (midis: number[]): number => Math.max(...midis) - Math.min(...midis);

  it('is an eerie, sparse loop around 100 bpm in B flat minor', () => {
    expect(theme.bpm).toBe(100);
    expect(theme.key).toEqual({ tonic: 10, scale: NATURAL_MINOR });
  });

  it('is sparser than the Drift, with a wider pad', () => {
    const drift = THEMES.drift;
    expect(notesOf(theme, 'arp').length).toBeLessThan(notesOf(drift, 'arp').length);
    expect(notesOf(theme, 'bass').length).toBeLessThan(notesOf(drift, 'bass').length);
    expect(notesOf(theme, 'hat').length).toBeLessThan(notesOf(drift, 'hat').length);
    for (const chord of theme.chords.keys()) {
      const pads = (t: MusicTheme): number[] => notesOf(t, 'pad').filter((n) => barOf(n) === chord).map((n) => n.midi);
      expect(span(pads(theme)), `bar ${String(chord)}`).toBeGreaterThan(span(pads(drift)));
    }
  });
});

describe('Singularity', () => {
  const theme = THEMES.singularity;

  it('is a driving loop around 124 bpm in E harmonic minor, faster than every other base theme', () => {
    expect(theme.bpm).toBe(124);
    expect(theme.key).toEqual({ tonic: 4, scale: HARMONIC_MINOR });
    for (const other of ['drift', 'ionReach', 'crimsonNebula', 'voidRift'] as const) expect(theme.bpm).toBeGreaterThan(THEMES[other].bpm);
  });

  it('runs a sixteenth-note arpeggio with a leading harmonic-minor dominant: the B chord', () => {
    expect(notesOf(theme, 'arp')[0]?.duration).toBe(0.25);
    expect(theme.chords.at(-1)?.bass).toBe(35);
  });
});

describe('the five themes', () => {
  it('differ in tempo, key or scale from one another', () => {
    const fingerprints = (['drift', 'ionReach', 'crimsonNebula', 'voidRift', 'singularity'] as const).map((id) => JSON.stringify([THEMES[id].bpm, THEMES[id].key]));
    expect(new Set(fingerprints).size).toBe(5);
  });
});

describe.each([
  ['drift', 'driftBoss'],
  ['ionReach', 'ionReachBoss'],
  ['crimsonNebula', 'crimsonNebulaBoss'],
  ['voidRift', 'voidRiftBoss'],
  ['singularity', 'singularityBoss'],
] as const)('%s and its boss variant %s', (baseId, bossId) => {
  const base = THEMES[baseId];
  const boss = THEMES[bossId];

  it('share a key and chords', () => {
    expect(boss.key).toEqual(base.key);
    expect(boss.chords).toEqual(base.chords);
  });

  it('play faster in the boss variant', () => {
    expect(boss.bpm).toBeGreaterThan(base.bpm);
  });

  it('has a heavier bass: more hits a bar, and more weight behind them', () => {
    const weight = (theme: MusicTheme): number => notesOf(theme, 'bass').reduce((sum, n) => sum + n.velocity * n.duration, 0);
    expect(notesOf(boss, 'bass').length).toBeGreaterThan(notesOf(base, 'bass').length);
    expect(Math.max(...notesOf(boss, 'bass').map((n) => n.velocity))).toBeGreaterThan(Math.max(...notesOf(base, 'bass').map((n) => n.velocity)));
    expect(weight(boss)).toBeGreaterThan(weight(base));
  });

  it('drives its hats: at least twice as many as the base, and some of them on the beat', () => {
    expect(notesOf(boss, 'hat').length).toBeGreaterThanOrEqual(2 * notesOf(base, 'hat').length);
    expect(notesOf(boss, 'hat').some((n) => Number.isInteger(n.beat))).toBe(true);
    expect(notesOf(base, 'hat').some((n) => Number.isInteger(n.beat))).toBe(false);
  });
});
