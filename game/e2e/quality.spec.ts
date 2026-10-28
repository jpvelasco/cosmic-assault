import type { Page } from '@playwright/test';
import { expect, gameState, openGame, test, waitForBridge } from './fixtures';

/** The title card's backdrop filter and the alpha of its fill colour. */
function titleCardGlass(page: Page): Promise<{ blur: string; alpha: number }> {
  return page
    .getByRole('heading', { name: 'Cosmic Assault' })
    .locator('..')
    .evaluate((card) => {
      const style = getComputedStyle(card);
      const probe = document.createElement('canvas').getContext('2d');
      if (probe === null) throw new Error('No 2D canvas to read the card colour with');
      // Normalises any CSS colour syntax (color(), color-mix(), rgba()) to a pixel whose alpha can be read.
      probe.fillStyle = style.backgroundColor;
      probe.fillRect(0, 0, 1, 1);
      return { blur: style.backdropFilter, alpha: (probe.getImageData(0, 0, 1, 1).data[3] ?? 0) / 255 };
    });
}

test('?quality= pins a level, exposes it on the bridge and marks the page lite from low down', async ({ page }) => {
  await openGame(page, { quality: 'low' });

  expect((await gameState(page)).quality).toEqual({ index: 2, name: 'low' });
  await expect(page.locator('body')).toHaveClass(/\blite\b/);
});

test('the default quality is high with a clean page and empty frame stats', async ({ page }) => {
  await openGame(page);

  const state = await gameState(page);
  expect(state.quality).toEqual({ index: 0, name: 'high' });
  expect(state.frameStats).toEqual({ count: 0, p50: 0, p95: 0, longFrames: 0 });
  await expect(page.locator('body')).not.toHaveClass(/\blite\b/);
});

test('a bad ?quality= warns and adapts instead', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.goto('/?quality=ultra');
  await waitForBridge(page);

  expect((await gameState(page)).quality.index).toBe(0);
  expect(warnings.join('\n')).toContain('?quality=ultra');
});

test('lite quality drops the glass blur for a more opaque fill', async ({ page }) => {
  await openGame(page);
  const normal = await titleCardGlass(page);
  await openGame(page, { quality: 'lowest' });
  const lite = await titleCardGlass(page);

  expect(normal.blur).toContain('blur');
  expect(lite.blur).toBe('none');
  expect(lite.alpha).toBeGreaterThan(normal.alpha + 0.2);
});
