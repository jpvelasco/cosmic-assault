import { BUILD_LABEL, expect, test } from './fixtures';

test('release build boots to the title without the test bridge or console errors', async ({ page }) => {
  // Wait for the network to settle so a bridge chunk, if one were bundled, would have loaded.
  await page.goto('/', { waitUntil: 'networkidle' });

  await expect(page).toHaveTitle('Cosmic Assault');
  await expect(page.getByTestId('build-label')).toHaveText(BUILD_LABEL);
  expect(await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__ === undefined)).toBe(true);
});
