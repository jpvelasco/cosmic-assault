import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { createPagesServer, NOT_FOUND_BODY, type PagesMount, type PagesServer } from '../scripts/serve-pages.mjs';
import { defaultSave, SAVE_KEY } from '../src/meta/save';
import { expect, test as base } from './fixtures';

/*
 * The service workers across the move of the game from the preview address (next/) to the site root, on a server
 * that answers like GitHub Pages (scripts/serve-pages.mjs), both at an origin root and under a project path as Pages
 * serves this site.
 *
 * fixtures/pages/preview/sw.js is the preview's worker as published before the move: the sw.js of a release build of
 * commit 271163b, with only its precache list replaced by the fixture's own three files.
 *
 * Unlike Pages, the server sends `Cache-Control: no-cache`, so a swap of what it serves is seen at once. Pages sends
 * `max-age=600`, so on a real device a deploy can take up to ten minutes to show.
 *
 * Each test serves its own site on a free port and builds its own state, so a swap here never races another spec and
 * one failing case never hides another.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/pages/', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
/** The preview worker's caches: a name frozen in every device that ran the preview. */
const PREVIEW_CACHE_PREFIX = 'cosmic-assault-next-';
/** The root worker's caches, which a cleanup of the preview's never matches. */
const ROOT_CACHE_PREFIX = 'cosmic-assault-v2-';
const MOVE_TIMEOUT_MS = 10_000;

const classic: PagesMount = { dir: join(FIXTURES, 'classic'), at: './' };
const preview: PagesMount = { dir: join(FIXTURES, 'preview'), at: 'next/' };
const otherProject: PagesMount = { dir: join(FIXTURES, 'other-project'), at: '../other-project/' };
/** The site before the move: the classic game at the root and the preview at next/. */
const BEFORE = [classic, preview];

/** A save the game reads without writing back (the classic best is already imported), so it must survive byte for byte. */
const SEEDED = JSON.stringify({
  ...defaultSave(),
  frontier: '1-3',
  galaxies: { '1-1': { bestScore: 4321, stars: 3 }, '1-2': { bestScore: 1234, stars: 1 } },
  classicImported: true,
});

const test = base.extend<{ prefix: string; serve: (mounts: readonly PagesMount[]) => Promise<PagesServer> }>({
  prefix: ['/', { option: true }],
  serve: async ({ prefix }, use) => {
    const servers: PagesServer[] = [];
    await use(async (mounts) => {
      const server = await createPagesServer({ prefix, mounts });
      servers.push(server);
      return server;
    });
    await Promise.all(servers.map((server) => server.close()));
  },
});

// A page these cases expect to answer 404 logs its failed load.
test.use({ allowedErrors: ['the server responded with a status of 404'] });

const nextOf = (site: PagesServer): string => new URL('next/', site.url).href;
/** The names of the origin's caches that start with `prefix`. */
const cachesNamed = async (page: Page, prefix: string): Promise<string[]> =>
  (await page.evaluate(() => caches.keys())).filter((name) => name.startsWith(prefix));
const registrationScopes = (page: Page): Promise<string[]> =>
  page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope));

async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Opens the preview at next/ and waits for its worker to control the page, by which time its cache is filled. */
async function visitPreview(page: Page, site: PagesServer): Promise<void> {
  await page.goto(nextOf(site));
  await expect(page.getByRole('heading', { name: 'Preview build' })).toBeVisible();
  await waitForController(page);
}

/** Opens the game at the site root and waits for the root worker to control it. */
async function visitRoot(page: Page, site: PagesServer): Promise<void> {
  await page.goto(site.url);
  await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
  await waitForController(page);
}

/** The page has left next/ for the site root, and nothing of the preview's worker is left on the device. */
async function expectMovedToRoot(page: Page, site: PagesServer): Promise<void> {
  await expect(page, 'the page moves from next/ to the site root').toHaveURL(site.url, { timeout: MOVE_TIMEOUT_MS });
  await expect.poll(() => registrationScopes(page), { message: 'no worker is left registered for next/' }).not.toContain(nextOf(site));
  await expect.poll(() => cachesNamed(page, PREVIEW_CACHE_PREFIX), { message: 'no preview cache is left' }).toEqual([]);
}

for (const prefix of ['/', '/cosmic-assault/']) {
  const prefixed = prefix !== '/';
  /** The site after the move: the game build at the root, with another project beside it under a project path. */
  const reveal: PagesMount[] = [{ dir: DIST, at: './' }, ...(prefixed ? [otherProject] : [])];

  test.describe(`served at ${prefix}`, () => {
    test.use({ prefix });

    test('the preview worker answers for next/ from its cache, online once next/ is gone and offline', async ({ page, context, serve }) => {
      const site = await serve(BEFORE);
      await visitPreview(page, site);
      expect(await cachesNamed(page, PREVIEW_CACHE_PREFIX)).toHaveLength(1);

      site.setMounts([classic]);
      const online = await page.reload();
      expect(online?.status(), 'the worker answers the host\'s 404 with its cached page').toBe(200);
      await expect(page.getByRole('heading', { name: 'Preview build' })).toBeVisible();

      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Preview build' })).toBeVisible();
    });

    test('a device that ran the preview lands on the root with its save, and the preview worker and cache are gone', async ({ page, serve }) => {
      const site = await serve(BEFORE);
      await visitPreview(page, site);
      await page.evaluate(([key, text]) => {
        localStorage.setItem(key, text);
      }, [SAVE_KEY, SEEDED] as const);
      const rootErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && page.url() === site.url) rootErrors.push(message.text());
      });

      site.setMounts(reveal);
      await page.goto(nextOf(site));

      await expectMovedToRoot(page, site);
      expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope), 'the root worker serves the root').toBe(site.url);
      await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY), 'the save is untouched').toBe(SEEDED);
      expect(rootErrors, 'console errors on the root').toEqual([]);
    });

    test('a preview tab left open moves to the root when its worker updates', async ({ page, serve }) => {
      const site = await serve(BEFORE);
      await visitPreview(page, site);

      site.setMounts(reveal);
      // Not awaited: the update may navigate this very page.
      await page.evaluate(() => {
        void navigator.serviceWorker
          .getRegistration()
          .then((registration) => registration?.update())
          .catch(() => undefined);
      });

      await expectMovedToRoot(page, site);
    });

    test('an old link to next/ on a device that never ran the preview lands on the root', async ({ page, serve }) => {
      const site = await serve(reveal);
      await page.goto(nextOf(site));

      await expectMovedToRoot(page, site);
    });

    test('the root worker never answers for next/: once it is gone, next/ is the host\'s 404 online and an error offline', async ({ page, context, serve }, testInfo) => {
      const site = await serve(reveal);
      await visitRoot(page, site);
      const hidden = testInfo.outputPath('hidden-next');
      mkdirSync(hidden, { recursive: true });
      site.setMounts([...reveal, { dir: hidden, at: 'next/' }]);

      const missing = await page.goto(nextOf(site));
      expect(missing?.status(), 'next/ answers the host\'s 404, not the cached game').toBe(404);
      expect(await missing?.text()).toBe(NOT_FOUND_BODY);

      const withoutSlash = nextOf(site).slice(0, -1);
      const moved = await page.goto(withoutSlash);
      expect(moved?.status()).toBe(404);
      const redirect = moved?.request().redirectedFrom();
      expect(redirect?.url(), 'next answers 301 to next/ first').toBe(withoutSlash);
      expect((await redirect?.response())?.status()).toBe(301);

      await context.setOffline(true);
      await expect(page.goto(nextOf(site)), 'offline, next/ is a network error, not the cached game').rejects.toThrow(/net::ERR_/);
    });

    if (prefixed) {
      test('another project on the same host is outside the root worker\'s scope', async ({ page, serve }) => {
        const site = await serve(reveal);
        await visitRoot(page, site);

        await page.goto(new URL('../other-project/', site.url).href);
        await expect(page.getByRole('heading', { name: 'Another project' })).toBeVisible();
        expect(await page.evaluate(() => navigator.serviceWorker.controller === null), 'no worker controls the other project').toBe(true);
      });
    }

    test('the next deploy replaces the root cache with its own and still plays offline', async ({ page, context, serve }) => {
      const site = await serve(reveal);
      await visitRoot(page, site);
      const ours = await cachesNamed(page, ROOT_CACHE_PREFIX);
      expect(ours, `the root worker keeps one cache, named ${ROOT_CACHE_PREFIX}<version>`).toHaveLength(1);
      const version = (ours[0] ?? '').slice(ROOT_CACHE_PREFIX.length);

      site.rewrite('sw.js', version, `${version}b`);
      await page.reload();
      await page.reload();

      await expect.poll(() => cachesNamed(page, ROOT_CACHE_PREFIX), { message: 'only the new deploy\'s cache is left' }).toEqual([
        `${ROOT_CACHE_PREFIX}${version}b`,
      ]);
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
    });

    test('restoring the classic site with a self-removing root worker leaves no root worker or cache', async ({ page, serve }, testInfo) => {
      const restoreWorker = process.env['RESTORE_SW'];
      test.skip(restoreWorker === undefined, 'set RESTORE_SW to the path of a root worker that removes itself');
      const restored = testInfo.outputPath('restored');
      mkdirSync(restored, { recursive: true });
      copyFileSync(join(classic.dir, 'index.html'), join(restored, 'index.html'));
      copyFileSync(restoreWorker ?? '', join(restored, 'sw.js'));
      const site = await serve(reveal);
      await visitRoot(page, site);

      site.setMounts([{ dir: restored, at: './' }]);
      await page.reload();

      await expect(page.getByRole('heading', { name: 'Classic site' })).toBeVisible();
      await expect.poll(() => registrationScopes(page), { message: 'no worker is left registered for the root' }).not.toContain(site.url);
      await expect.poll(() => cachesNamed(page, ROOT_CACHE_PREFIX), { message: 'no root cache is left' }).toEqual([]);
    });
  });
}
