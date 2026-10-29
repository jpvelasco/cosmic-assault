import { precacheName, PREVIEW_CACHE_PREFIX } from '../src/platform/swLogic';
import { expect, openGame, test, waitForBridge } from './fixtures';

/** Ours to delete: an older build's cache, and one the preview address left. */
const STALE = [precacheName('old'), `${PREVIEW_CACHE_PREFIX}old`];
/** Not ours, so kept: another app's cache, and one whose name merely shares the game's words. */
const FOREIGN = ['another-app-cache', 'cosmic-assault-legacy'];

test('after one visit the game starts offline, keeping only this build of our cache', async ({ page, context, baseURL }) => {
  // sw.js is a page at this origin that no worker controls yet, so the caches are seeded before registration.
  await page.goto('/sw.js');
  await page.evaluate(async (names) => {
    await Promise.all(names.map((name) => caches.open(name)));
  }, [...STALE, ...FOREIGN]);

  await openGame(page);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope, 'the default scope: the directory holding index.html').toBe(new URL('/', baseURL).href);
  // Activation drops stale caches before it claims the page, so a controller means the clean-up is done.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const keys = await page.evaluate(() => caches.keys());
  expect(keys.filter((name) => STALE.includes(name)), 'the stale caches are gone').toEqual([]);
  expect(keys, 'the foreign ones are kept').toEqual(expect.arrayContaining(FOREIGN));
  const ours = keys.filter((name) => !FOREIGN.includes(name));
  expect(ours).toHaveLength(1);
  expect(ours[0]).toMatch(new RegExp(`^${precacheName('')}[0-9a-f]+$`));
  const scripts = await page.evaluate(() => [...document.scripts].map((script) => script.src));
  const cached = await page.evaluate(
    async ({ name, urls }) => {
      const cache = await caches.open(name);
      return Promise.all(urls.map(async (url) => (await cache.match(url)) !== undefined));
    },
    { name: ours[0] ?? '', urls: [new URL('index.html', baseURL).href, ...scripts] },
  );
  expect(cached, 'index.html and the entry script are precached').toEqual(cached.map(() => true));

  await context.setOffline(true);
  await page.reload();
  await waitForBridge(page);
  await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'the offline page is served by the worker').toBe(true);
});
