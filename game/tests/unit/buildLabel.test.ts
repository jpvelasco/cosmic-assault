import { describe, expect, it } from 'vitest';
import { formatBuildLabel } from '../../src/buildLabel';

describe('formatBuildLabel', () => {
  it('shortens the commit sha and keeps the date', () => {
    expect(formatBuildLabel('8f3c2a91d4e5b6c7', '2026-10-24T18:02:11.000Z')).toBe('preview · 8f3c2a9 · 2026-10-24');
  });
  it('labels local builds', () => {
    expect(formatBuildLabel(undefined, '2026-10-24T18:02:11.000Z')).toBe('preview · local · 2026-10-24');
  });
  it('labels local builds that pass an empty sha', () => {
    expect(formatBuildLabel('', '2026-10-24T18:02:11.000Z')).toBe('preview · local · 2026-10-24');
  });
});
