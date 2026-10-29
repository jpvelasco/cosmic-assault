import { describe, expect, it } from 'vitest';
import { currentBuildLabel, formatBuildLabel } from '../../src/buildLabel';
import { APP_VERSION } from '../../vite/appVersion';

describe('formatBuildLabel', () => {
  it('names the version, shortens the commit sha and keeps the date', () => {
    expect(formatBuildLabel('2.0.0', '8f3c2a91d4e5b6c7', '2026-10-24T18:02:11.000Z')).toBe('v2.0.0 · 8f3c2a9 · 2026-10-24');
  });
  it('labels local builds', () => {
    expect(formatBuildLabel('2.0.0', undefined, '2026-10-24T18:02:11.000Z')).toBe('v2.0.0 · local · 2026-10-24');
  });
  it('labels local builds that pass an empty sha', () => {
    expect(formatBuildLabel('2.0.0', '', '2026-10-24T18:02:11.000Z')).toBe('v2.0.0 · local · 2026-10-24');
  });
});

describe('currentBuildLabel', () => {
  it('names the version in package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(currentBuildLabel().split(' · ')[0]).toBe(`v${APP_VERSION}`);
  });
});
