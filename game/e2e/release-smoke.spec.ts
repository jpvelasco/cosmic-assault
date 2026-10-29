import type { Page } from '@playwright/test';
import { localDate } from '../src/app/date';
import { E2E_QUERY_MARK } from '../src/app/seed';
import { ATTRACT_IDLE_TIMEOUT_MS, BUILD_LABEL, dailyCardLineOf, expect, test } from './fixtures';
import { BOSS_GALAXY } from './seeds';

// Every page here is opened relative to baseURL ('./', never '/'), so under the site's project path the tests stay
// inside it. At the server root the two are the same address.

/** A date the device's own is not, for `?today=`. */
const PINNED_TODAY = '2099-06-15';

/** Fails unless the test bridge is absent from the page. */
async function expectNoBridge(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__ === undefined), 'the test bridge is absent').toBe(true);
}

/** Title → mode select by Play, whose Daily card must be the device's own date's and not PINNED_TODAY's. */
async function expectDailyOfDeviceDate(page: Page): Promise<void> {
  // The page's own local date, by the app's one owner of that rule, run in the page's time zone.
  const today = await page.evaluate(localDate, new Date());
  expect(dailyCardLineOf(PINNED_TODAY), 'the pinned date must offer another Daily than today\'s for this to tell them apart').not.toBe(dailyCardLineOf(today));

  await page.getByTestId('play').click();
  await expect(page.getByTestId('mode-daily')).toContainText(dailyCardLineOf(today));
}

test('release build boots to the title without the test bridge or console errors', { tag: '@release' }, async ({ page }) => {
  // Wait for the network to settle so a bridge chunk, if one were bundled, would have loaded.
  await page.goto('./', { waitUntil: 'networkidle' });

  await expect(page).toHaveTitle('Cosmic Assault');
  await expect(page.getByTestId('build-label')).toHaveText(BUILD_LABEL);
  await expectNoBridge(page);
});

test('release build registers its service worker for the directory it is served from', { tag: '@release' }, async ({ page, baseURL }) => {
  await page.goto('./');

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope, 'the directory the site is served from, ending in /').toBe(new URL('./', baseURL).href);
});

test('release build ignores ?today=, so mode select offers the Daily of the device\'s own date', { tag: '@release' }, async ({ page }) => {
  await page.goto(`./?today=${PINNED_TODAY}`);
  await expectDailyOfDeviceDate(page);
});

test('every e2e override is inert in the release build: Play opens mode select with today\'s Daily, and the map is a fresh save\'s', { tag: '@release' }, async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const query = new URLSearchParams({ seed: '7', lives: '9', quality: '0', storm: '30', today: PINNED_TODAY, galaxy: BOSS_GALAXY });
  await page.goto(`./?${query.toString()}`, { waitUntil: 'networkidle' });

  await expect(page.getByTestId('build-label')).toHaveText(BUILD_LABEL);
  await expectNoBridge(page);
  // With ?galaxy= honoured, Play would start that galaxy instead of opening mode select.
  await expectDailyOfDeviceDate(page);

  await page.getByTestId('mode-free').click();
  await expect(page.getByTestId('dimension-1')).toBeEnabled();
  await expect(page.getByTestId('dimension-2')).toBeDisabled();
  await page.getByTestId('dimension-1').click();
  await expect(page.getByTestId('galaxy-1-1')).toBeEnabled();
  await expect(page.getByTestId('galaxy-1-2')).toBeDisabled();
  expect(warnings.filter((text) => text.includes(E2E_QUERY_MARK)), 'the release build never reads the query, so it warns about none of it').toEqual([]);
});

test('release build plays the attract demo behind the title after the idle stretch, as it is part of the game', { tag: '@release' }, async ({ page }) => {
  test.setTimeout(ATTRACT_IDLE_TIMEOUT_MS + 15_000);
  await page.goto('./');
  await expect(page.locator('.overlay--title')).toHaveClass(/title--attract/, { timeout: ATTRACT_IDLE_TIMEOUT_MS });
  await expect(page.getByTestId('demo-label')).toBeVisible();
});
