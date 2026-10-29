import { expect, fastForward, gameState, openGame, startRun, test } from './fixtures';

/** A storm added at 4 s by `?storm=`, so its wells warn from 1 s and pull from 4 s. */
const STORM_AT = 4;
/** Far enough into the warning for every well to be drawn, short of the pull. */
const WARNING_SECONDS = 2;

test.describe('a gravity storm', () => {
  for (const [device, tag] of [
    ['a desktop', '@desktop'],
    ['a Pixel 5 in landscape', '@phone'],
  ] as const) {
    test(`warns as linked wells inside a dotted ring on ${device}`, { tag }, async ({ page, isMobile }, testInfo) => {
      await openGame(page, { galaxy: '2-2', storm: STORM_AT });
      await startRun(page, isMobile);
      await fastForward(page, WARNING_SECONDS);
      const { hazards } = await gameState(page);
      const warning = hazards.filter((h) => h.type === 'gravityWell' && h.stage === 'warning');
      expect(warning.length).toBeGreaterThanOrEqual(2);
      // One storm: its wells warn together, each of intensity 1.
      for (const well of warning) expect(well.intensity).toBe(1);
      expect(new Set(warning.map((w) => w.remaining)).size).toBe(1);
      expect(warning[0]?.remaining).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath(`storm-warning-${tag.slice(1)}.png`) });
    });
  }
});
