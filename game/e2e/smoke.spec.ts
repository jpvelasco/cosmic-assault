import { BUILD_LABEL, expect, openGame, test } from './fixtures';

test('e2e build boots to the title with the test bridge and no console errors', async ({ page }) => {
  await openGame(page);

  await expect(page).toHaveTitle('Cosmic Assault');
  await expect(page.getByTestId('build-label')).toHaveText(BUILD_LABEL);
});
