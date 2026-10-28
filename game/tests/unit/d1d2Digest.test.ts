import { expect, it } from 'vitest';
import { canonicalEvent, describeDigests } from '../helpers/eventDigest';

// The fast, scripted half of the D1–D2 pins; the expert's whole runs are in tests/balance/d1-expertDigests.test.ts.
describeDigests('scripted', () => {
  it('leaves out only the labels added since the digests were recorded: a well event still digests its place, time and id', () => {
    expect(canonicalEvent({ type: 'wellStart', id: 7, kind: 'gravityWell' })).toBe('id=7 type="wellStart"');
    expect(canonicalEvent({ type: 'wellWarning', id: 7, kind: 'gravityWell', x: 1.5, y: 2, at: 25 })).toBe('at=25 type="wellWarning" x=1.5 y=2');
    expect(canonicalEvent({ type: 'foeSpawned', id: 3, kind: 'drone', x: 0, y: 1 })).toBe('id=3 kind="drone" type="foeSpawned" x=0 y=1');
  });
});
