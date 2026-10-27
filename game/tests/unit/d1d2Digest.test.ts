import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalEvent, DIGEST_GALAXIES, DIGEST_INPUTS, DIGEST_SEEDS, digestKey, digestRuns, digestsOf, type DigestInput, type DigestRun } from '../helpers/eventDigest';
import { galaxyById } from '../../src/content/galaxies';

const FIXTURE_URL = new URL('../fixtures/d1-d2-digests.json', import.meta.url);
const INPUTS = Object.keys(DIGEST_INPUTS) as DigestInput[];
/** The expert plays 36 whole galaxies; a loaded CI runner needs more than Vitest's 5 s default. */
const PLAY_TIMEOUT_MS = 120_000;

interface DigestFixture {
  readonly recordedAt: string;
  readonly digests: Readonly<Record<DigestInput, Readonly<Record<string, string>>>>;
}

const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as DigestFixture;
const runs = {} as Record<DigestInput, Record<string, DigestRun>>;

describe('Dimensions 1 and 2 do not move', () => {
  beforeAll(() => {
    for (const input of INPUTS) runs[input] = digestRuns(input);
    // Recording is a ruling's call, never a fix for a failing digest: RECORD_D1D2_DIGESTS='<ruling or commit>' npx vitest run tests/unit/d1d2Digest.test.ts
    const label = process.env.RECORD_D1D2_DIGESTS;
    if (label !== undefined && label !== '') {
      const digests = Object.fromEntries(INPUTS.map((input) => [input, digestsOf(runs[input])]));
      writeFileSync(FIXTURE_URL, `${JSON.stringify({ recordedAt: label, digests }, null, 2)}\n`);
    }
  }, PLAY_TIMEOUT_MS);

  it('covers every D1–D2 galaxy on seeds 1–3 under both inputs', () => {
    const keys = DIGEST_GALAXIES.flatMap((id) => DIGEST_SEEDS.map((seed) => digestKey(id, seed)));
    expect(keys).toHaveLength(36);
    for (const input of INPUTS) {
      expect(Object.keys(fixture.digests[input]), input).toEqual(keys);
      expect(Object.keys(runs[input]), input).toEqual(keys);
    }
  });

  it.each(INPUTS.flatMap((input) => Object.keys(fixture.digests[input]).map((key) => [input, key] as const)))('plays %s %s event for event as recorded at the M5 tip', (input, key) => {
    expect(runs[input][key]?.digest, `${input} ${key} moved: a change has altered D1–D2 play; find it, or get a ruling to re-record the digests`).toBe(fixture.digests[input][key]);
  });

  it('plays every D2 galaxy to its clear under the expert, so its late phases, warp and clear report are pinned', () => {
    for (const id of DIGEST_GALAXIES.filter((g) => g.startsWith('2-'))) for (const seed of DIGEST_SEEDS) expect(runs.expert[digestKey(id, seed)]?.status, digestKey(id, seed)).toBe('cleared');
  });

  it('sees every scheduled well of every galaxy end, under the expert', () => {
    const wellGalaxies = DIGEST_GALAXIES.filter((id) => galaxyById(id).events.some((e) => e.type === 'gravityWell'));
    expect(wellGalaxies).toEqual(['2-2', '2-3', '2-4', '2-5']);
    for (const id of wellGalaxies) for (const seed of DIGEST_SEEDS) expect(runs.expert[digestKey(id, seed)]?.types.has('wellEnd'), digestKey(id, seed)).toBe(true);
  });

  it('leaves out only the labels added since M5: a well event still digests its place, time and id', () => {
    expect(canonicalEvent({ type: 'wellStart', id: 7, kind: 'gravityWell' })).toBe('id=7 type="wellStart"');
    expect(canonicalEvent({ type: 'wellWarning', id: 7, kind: 'gravityWell', x: 1.5, y: 2, at: 25 })).toBe('at=25 type="wellWarning" x=1.5 y=2');
    expect(canonicalEvent({ type: 'foeSpawned', id: 3, kind: 'drone', x: 0, y: 1 })).toBe('id=3 kind="drone" type="foeSpawned" x=0 y=1');
  });
});
