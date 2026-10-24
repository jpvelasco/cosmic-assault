import { expect, test } from '@playwright/test';

test('production build boots with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  await page.goto('/');

  await expect(page).toHaveTitle('Cosmic Assault');
  await expect(page.getByTestId('build-label')).toHaveText(
    /^preview · (local|[0-9a-f]{7}) · \d{4}-\d{2}-\d{2}$/,
  );
  expect(errors).toEqual([]);
});
