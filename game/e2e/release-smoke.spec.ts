import { localDate } from '../src/app/date';
import { TWISTS_BY_ID } from '../src/content/daily';
import { dailyGalaxy } from '../src/meta/dailyGalaxy';
import { dailyCardLine } from '../src/ui/dailyCopy';
import { ATTRACT_IDLE_TIMEOUT_MS, BUILD_LABEL, expect, test } from './fixtures';

test('release build boots to the title without the test bridge or console errors', { tag: '@release' }, async ({ page }) => {
  // Wait for the network to settle so a bridge chunk, if one were bundled, would have loaded.
  await page.goto('/', { waitUntil: 'networkidle' });

  await expect(page).toHaveTitle('Cosmic Assault');
  await expect(page.getByTestId('build-label')).toHaveText(BUILD_LABEL);
  expect(await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__ === undefined)).toBe(true);
});

test('release build registers its service worker for the directory it is served from', { tag: '@release' }, async ({ page, baseURL }) => {
  await page.goto('/');

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope, 'the server root, ending in /').toBe(new URL('/', baseURL).href);
});

test('release build ignores ?today=, so mode select offers the Daily of the device\'s own date', { tag: '@release' }, async ({ page }) => {
  const pinned = '2099-06-15';
  await page.goto(`/?today=${pinned}`);
  // The page's own local date, by the app's one owner of that rule, run in the page's time zone.
  const today = await page.evaluate(localDate, new Date());
  const lineOf = (date: string): string => {
    const { twist, target } = dailyGalaxy(date);
    return dailyCardLine(TWISTS_BY_ID[twist].name, target);
  };
  expect(lineOf(pinned), 'the pinned date must offer another Daily than today\'s for this to tell them apart').not.toBe(lineOf(today));

  await page.getByTestId('play').click();
  await expect(page.getByTestId('mode-daily')).toContainText(lineOf(today));
});

test('release build plays the attract demo behind the title after the idle stretch, as it is part of the game', { tag: '@release' }, async ({ page }) => {
  test.setTimeout(ATTRACT_IDLE_TIMEOUT_MS + 15_000);
  await page.goto('/');
  await expect(page.locator('.overlay--title')).toHaveClass(/title--attract/, { timeout: ATTRACT_IDLE_TIMEOUT_MS });
  await expect(page.getByTestId('demo-label')).toBeVisible();
});
