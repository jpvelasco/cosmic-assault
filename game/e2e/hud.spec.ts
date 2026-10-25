import type { Page } from '@playwright/test';
import { expect, expectMode, gameState, nextFrames, openGame, test } from './fixtures';

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

/** CA-024: on a touch screen the HUD pills stay on screen and out from under the pause button. */
async function expectHudClearOfPause(page: Page): Promise<void> {
  await startRun(page);

  const pause = await page.getByTestId('touch-pause').boundingBox();
  if (pause === null) throw new Error('The pause button has no layout box; is the touch layer shown?');
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('The project has no viewport; set one in playwright.config.ts');
  const { hudRects } = await gameState(page);

  // Score, lives and practice level.
  expect(hudRects).toHaveLength(3);
  for (const rect of hudRects) {
    expect(intersects(rect, pause), `HUD pill ${JSON.stringify(rect)} overlaps the pause button`).toBe(false);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  }
}

test('the HUD stays inside the viewport and clear of the pause button', async ({ page }) => {
  await expectHudClearOfPause(page);
});

test.describe('on an 844×390 phone', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('the HUD stays inside the viewport and clear of the pause button', async ({ page }) => {
    await expectHudClearOfPause(page);
  });
});

test('sprites are drawn larger on a phone screen', async ({ page }) => {
  await startRun(page);
  const { visualScale } = await gameState(page);
  expect(visualScale.ship).toBeGreaterThan(1.2);
  expect(visualScale.rock).toBeGreaterThan(1);
  expect(visualScale.rock).toBeLessThan(visualScale.ship);
  await page.screenshot({ path: '/tmp/m3-phone-scale.png' });
});

test.describe('on a 1280×720 screen', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('sprites are drawn at their field size', async ({ page }) => {
    await startRun(page);
    expect((await gameState(page)).visualScale).toEqual({ ship: 1, rock: 1, shot: 1, effect: 1 });
  });
});
