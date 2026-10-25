import { expect, gameState, openGame, test } from './fixtures';

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
  await page.waitForFunction(() => window.__COSMIC_ASSAULT_TEST_API__?.version === 3);

  expect((await gameState(page)).quality.index).toBe(0);
  expect(warnings.join('\n')).toContain('?quality=ultra');
});
