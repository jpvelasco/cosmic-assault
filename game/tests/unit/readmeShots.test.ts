import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidateWidths, SHOT_BYTE_CAP, SHOTS, SHOTS_DIR, shotQuery } from '../../scripts/readme-shots.mjs';
import { entryFor, type ClaimId } from '../../e2e/seeds';
import { readPng } from '../helpers/png';

const README = readFileSync(new URL('../../../ReadMe.md', import.meta.url), 'utf8');
const RERUN = 'run npm run readme-shots from game/ (it needs Playwright\'s Chromium) and commit the PNGs it writes';

describe('the README stills', () => {
  it('are three or four, each a distinct lower-case ASCII .png name', () => {
    const files = SHOTS.map(({ file }) => file);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.length).toBeLessThanOrEqual(4);
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) expect(file).toMatch(/^[a-z0-9-]+\.png$/);
  });

  it('are exactly the ones ReadMe.md links from docs/assets/screens/', () => {
    const linked = [...README.matchAll(/docs\/assets\/screens\/([^")\s]+)/g)].map((match) => match[1]);
    expect(new Set(linked)).toEqual(new Set(SHOTS.map(({ file }) => file)));
  });

  it('play each galaxy on the seed of the e2e claim that vouches for its moment', () => {
    for (const { file, claim, galaxy, seed } of SHOTS) {
      if (claim === undefined) continue;
      const entry = entryFor(claim as ClaimId);
      expect({ galaxy, seed }, file).toEqual({ galaxy: entry.galaxy, seed: entry.seed });
    }
  });

  it('pin the top quality level, and stage a galaxy only through the e2e overrides', () => {
    expect(shotQuery({})).toBe('quality=high');
    expect(shotQuery({ seed: 176, galaxy: '3-4', lives: 5 })).toBe('seed=176&galaxy=3-4&lives=5&quality=high');
  });

  it('scale an oversized still down through ever narrower widths, starting at its own', () => {
    expect(candidateWidths(1280)).toEqual([1280, 1120, 960, 800, 640]);
    expect(candidateWidths(1702)).toEqual([1702, 1600, 1280, 1120, 960, 800, 640]);
    expect(candidateWidths(600)).toEqual([600]);
  });
});

describe.each(SHOTS.map(({ file }) => file))('docs/assets/screens/%s', (file) => {
  const path = join(SHOTS_DIR, file);

  it(`is a PNG of ${String(SHOT_BYTE_CAP / 1024)} KB at most`, () => {
    expect(existsSync(path), `${path} is missing: ${RERUN}`).toBe(true);
    const { bytes } = readPng(path, `: ${RERUN}`);
    expect(bytes.length, `${file} is over the cap: ${RERUN}`).toBeLessThanOrEqual(SHOT_BYTE_CAP);
  });
});
