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

/** CA-024: on a touch screen the HUD pills stay on screen and out from under the pause button. */
async function expectHudClearOfPause(page: Page): Promise<void> {
  await openGame(page);
  await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
  await expectMode(page, 'playing');
  await nextFrames(page, 3);

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
