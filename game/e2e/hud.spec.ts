import type { Page } from '@playwright/test';
import { TIMED_PICKUPS } from '../src/content/pickups';
import { PICKUP_PILL_SIZE } from '../src/render/hudPickups';
import { collectPickup, expect, expectMode, gameState, nextFrames, openGame, test } from './fixtures';
import { PHONE_VIEWPORT } from './seeds';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Starts a run by tapping the title screen. */
async function startRun(page: Page): Promise<void> {
  await openGame(page);
  await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
  await expectMode(page, 'playing');
  await nextFrames(page, 3);
}

/** What is wrong with the HUD pills drawn last: a pill overlapping another or the pause button, or reaching off the viewport. */
async function hudProblems(page: Page): Promise<{ readonly rects: readonly Box[]; readonly problems: string[] }> {
  const pause = await page.getByTestId('touch-pause').boundingBox();
  if (pause === null) throw new Error('The pause button has no layout box; is the touch layer shown?');
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('The project has no viewport; set one in playwright.config.ts');
  const { hudRects: rects } = await gameState(page);
  const problems: string[] = [];
  rects.forEach((rect, i) => {
    const pill = `HUD pill ${JSON.stringify(rect)}`;
    for (const other of rects.slice(i + 1)) if (intersects(rect, other)) problems.push(`${pill} overlaps ${JSON.stringify(other)}`);
    if (intersects(rect, pause)) problems.push(`${pill} overlaps the pause button`);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height) problems.push(`${pill} reaches off the viewport`);
  });
  return { rects, problems };
}

/** On a touch screen the HUD pills stay on screen and out from under the pause button. */
async function expectHudClearOfPause(page: Page): Promise<void> {
  await startRun(page);
  const { rects, problems } = await hudProblems(page);
  // Score, lives, the galaxy and its timer bar.
  expect(rects).toHaveLength(4);
  expect(problems).toEqual([]);
}

test('the HUD stays inside the viewport and clear of the pause button', async ({ page }) => {
  await expectHudClearOfPause(page);
});

test.describe('on an 844×390 phone', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('the HUD stays inside the viewport and clear of the pause button', async ({ page }) => {
    await expectHudClearOfPause(page);
  });
});

test('a full row of the eight timed pickup pills fits beside the lives, clear of the pause button, each countdown badge at full size', async ({ page }) => {
  await startRun(page);
  for (const kind of TIMED_PICKUPS) await collectPickup(page, kind);
  await nextFrames(page, 3);
  const { effects } = await gameState(page);
  expect(Object.keys(effects).sort(), 'every timed effect should be running').toEqual([...TIMED_PICKUPS].sort());
  const { rects, problems } = await hudProblems(page);
  expect(problems).toEqual([]);
  // The pickup badges are drawn last but the boss bar, which a survival galaxy never shows.
  const badges = rects.slice(-TIMED_PICKUPS.length);
  expect(rects.length, 'the score, lives, galaxy and timer pills, any combo pill, and a badge per effect').toBeGreaterThanOrEqual(4 + TIMED_PICKUPS.length);
  for (const badge of badges) {
    // A countdown's sweep and glyph are drawn for a badge this size: any smaller and they blur into each other.
    expect(badge.width, `badge ${JSON.stringify(badge)}`).toBeGreaterThanOrEqual(PICKUP_PILL_SIZE);
    expect(badge.height, `badge ${JSON.stringify(badge)}`).toBeCloseTo(badge.width, 6);
  }
  // One row: every badge on the lives row, left to right.
  const [first] = badges;
  for (const [i, badge] of badges.entries()) {
    expect(badge.y, `badge ${String(i)}`).toBeCloseTo(first?.y ?? NaN, 6);
    if (i > 0) expect(badge.x).toBeGreaterThan(badges[i - 1]?.x ?? Infinity);
  }
  await page.screenshot({ path: test.info().outputPath('hud-pickup-row.png') });
});

test('sprites are drawn larger on a phone screen', async ({ page }, testInfo) => {
  await startRun(page);
  const { visualScale } = await gameState(page);
  expect(visualScale.ship).toBeGreaterThan(1.2);
  expect(visualScale.rock).toBeGreaterThan(1);
  expect(visualScale.rock).toBeLessThan(visualScale.ship);
  await page.screenshot({ path: testInfo.outputPath('phone-scale.png') });
});

test.describe('on a 1280×720 screen', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('sprites are drawn at their field size', async ({ page }) => {
    await startRun(page);
    expect((await gameState(page)).visualScale).toEqual({ ship: 1, rock: 1, shot: 1, effect: 1 });
  });
});
