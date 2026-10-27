import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalEvent, DIGEST_GALAXIES, DIGEST_SEEDS, galaxyDigests } from '../helpers/eventDigest';

const FIXTURE_URL = new URL('../fixtures/d1-d2-digests.json', import.meta.url);

interface DigestFixture {
  readonly recordedAt: string;
  readonly digests: Readonly<Record<string, string>>;
}

describe('Dimensions 1 and 2 do not move', () => {
  const digests = galaxyDigests();
  // Recording is a ruling's call, never a fix for a failing digest: RECORD_D1D2_DIGESTS=1 npx vitest run tests/unit/d1d2Digest.test.ts
  if (process.env.RECORD_D1D2_DIGESTS === '1') {
    writeFileSync(FIXTURE_URL, `${JSON.stringify({ recordedAt: 'M5 tip 98ab3c2, before the M6 hazard framework', digests }, null, 2)}\n`);
  }
  const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as DigestFixture;

  it('covers every D1–D2 galaxy on seeds 1–3', () => {
    expect(Object.keys(fixture.digests)).toHaveLength(DIGEST_GALAXIES.length * DIGEST_SEEDS.length);
    expect(Object.keys(digests)).toEqual(Object.keys(fixture.digests));
  });

  it.each(Object.keys(fixture.digests))('plays %s event for event as recorded at the M5 tip', (key) => {
    expect(digests[key], `${key} moved: a change has altered D1–D2 play; find it, or get a ruling to re-record the digests`).toBe(fixture.digests[key]);
  });

  it('leaves out only the labels added since M5: a well event still digests its place, time and id', () => {
    expect(canonicalEvent({ type: 'wellStart', id: 7, kind: 'gravityWell' })).toBe('id=7 type="wellStart"');
    expect(canonicalEvent({ type: 'wellWarning', id: 7, kind: 'gravityWell', x: 1.5, y: 2, at: 25 })).toBe('at=25 type="wellWarning" x=1.5 y=2');
    expect(canonicalEvent({ type: 'foeSpawned', id: 3, kind: 'drone', x: 0, y: 1 })).toBe('id=3 kind="drone" type="foeSpawned" x=0 y=1');
  });
});
