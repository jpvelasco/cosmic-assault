import { BUILD_LABEL, expect, openGame, test } from './fixtures';

test('e2e build boots to the title with the test bridge and no console errors', async ({ page }) => {
  await openGame(page);

  await expect(page).toHaveTitle('Cosmic Assault');
  await expect(page.getByTestId('build-label')).toHaveText(BUILD_LABEL);
  await expect(page.getByText('Press Space or tap to start')).toBeVisible();
});

test('the page never rubber-bands or pulls to refresh', async ({ page }) => {
  await openGame(page);

  const overscroll = await page.evaluate(() =>
    [document.documentElement, document.body].map((el) => getComputedStyle(el).overscrollBehavior),
  );
  expect(overscroll).toEqual(['none', 'none']);
});
