import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { createPagesServer, NOT_FOUND_BODY, PAGES_MAX_AGE_SECONDS, type PagesMount, type PagesServer } from '../scripts/serve-pages.mjs';
import { filesIn } from '../scripts/site.mjs';
import { defaultSave, SAVE_KEY } from '../src/meta/save';
import { PREVIEW_CACHE_PREFIX } from '../src/platform/swLogic';
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
 * `max-age=600`, so on a real device a deploy can take up to ten minutes to show. That makes the browser revalidate
 * every file in these cases, so one case serves the game as Pages caches it, to prove that the next deploy's page is
 * never taken from that cache.
 *
 * Each test serves its own site on a free port and builds its own state, so a swap here never races another spec and
 * one failing case never hides another.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/pages/', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
/** The root worker's caches, which a cleanup of the preview's never matches. */
const ROOT_CACHE_PREFIX = 'cosmic-assault-v2-';
const MOVE_TIMEOUT_MS = 10_000;
/** How long a page waits for a worker to become ready before the case reports that none did. */
const READY_TIMEOUT_MS = 5_000;
/** Longer than the preview worker's wait for the network (3 s), after which it answers a navigation from its cache. */
const SLOW_STUB_MS = 5_000;
/** The move on a slow network waits for the browser's own update check, which comes in its own time. */
const SLOW_MOVE_TIMEOUT_MS = 30_000;
/** Marks the page of the deploy that writeNextDeploy() makes. */
const NEXT_DEPLOY_MARK = '<meta name="deploy" content="next">';
/** The built files that name other built files. */
const TEXT_FILES = new Set(['.html', '.js', '.css', '.webmanifest']);

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

/**
 * Writes into `dir` the build as the next deploy would be: every asset under a new name and the old names gone, the
 * page and the worker naming the new ones, the worker's version `<version>b`, and the page marked with NEXT_DEPLOY_MARK.
 */
function writeNextDeploy(dir: string, version: string): void {
  cpSync(DIST, dir, { recursive: true });
  const assets = join(dir, 'assets');
  const renames = readdirSync(assets).map((name) => {
    const renamed = name.replace(/(\.\w+)$/, '-next$1');
    renameSync(join(assets, name), join(assets, renamed));
    return [name, renamed] as const;
  });
  for (const file of filesIn(dir).filter((name) => TEXT_FILES.has(extname(name)))) {
    const path = join(dir, file);
    let text = renames.reduce((current, [from, to]) => current.replaceAll(from, to), readFileSync(path, 'utf8'));
    if (file === 'sw.js') text = text.replaceAll(version, `${version}b`);
    if (file === 'index.html') text = text.replace('</head>', `${NEXT_DEPLOY_MARK}</head>`);
    writeFileSync(path, text);
  }
}

const nextOf = (site: PagesServer): string => new URL('next/', site.url).href;
/** The names of the origin's caches that start with `prefix`. */
const cachesNamed = async (page: Page, prefix: string): Promise<string[]> =>
  (await page.evaluate(() => caches.keys())).filter((name) => name.startsWith(prefix));
/** The version in the name of the root worker's cache, once the case has checked that there is exactly one. */
async function rootVersion(page: Page): Promise<string> {
  const ours = await cachesNamed(page, ROOT_CACHE_PREFIX);
  expect(ours, `the root worker keeps one cache, named ${ROOT_CACHE_PREFIX}<version>`).toHaveLength(1);
  return (ours[0] ?? '').slice(ROOT_CACHE_PREFIX.length);
}
const registrationScopes = (page: Page): Promise<string[]> =>
  page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope));

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The scope of the worker that serves the page, or a note that none became ready in time. */
const readyScope = (page: Page): Promise<string> =>
  page.evaluate(async (ms) => {
    const late = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(`no worker became ready within ${String(ms)} ms`);
      }, ms);
    });
    return Promise.race([navigator.serviceWorker.ready.then((registration) => registration.scope), late]);
  }, READY_TIMEOUT_MS);

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
async function expectMovedToRoot(page: Page, site: PagesServer, timeout = MOVE_TIMEOUT_MS): Promise<void> {
  await expect(page, 'the page moves from next/ to the site root').toHaveURL(site.url, { timeout });
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
      expect(await readyScope(page), 'the root worker serves the root').toBe(site.url);
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

    test.describe('once next/ is gone', () => {
      // Its 404 answers are logged as failed loads.
      test.use({ allowedErrors: ['the server responded with a status of 404'] });

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

    test('a device that plays at the root keeps the root worker and its cache when it opens next/, and still plays offline', async ({ page, context, serve }) => {
      const site = await serve(reveal);
      await visitRoot(page, site);
      const ours = `${ROOT_CACHE_PREFIX}${await rootVersion(page)}`;
      // The root worker has already activated, so only the retiring worker can delete this: its going proves that worker
      // ran, rather than the stub page's own timed move to the root.
      const decoy = `${PREVIEW_CACHE_PREFIX}decoy`;
      await page.evaluate(async (name) => {
        await caches.open(name);
      }, decoy);
      expect(await cachesNamed(page, PREVIEW_CACHE_PREFIX)).toEqual([decoy]);

      await page.goto(nextOf(site));

      await expectMovedToRoot(page, site);
      await expect.poll(() => registrationScopes(page), { message: 'only the root worker is left registered' }).toEqual([site.url]);
      expect(await readyScope(page), 'the root worker serves the root').toBe(site.url);
      expect(await cachesNamed(page, ROOT_CACHE_PREFIX), 'the root cache is untouched').toEqual([ours]);
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
    });

    test('on a slow network, a device that ran the preview reaches the root through the browser\'s own update check', async ({ page, context, serve }) => {
      test.setTimeout(60_000);
      const site = await serve(BEFORE);
      await visitPreview(page, site);
      site.setMounts(reveal);
      // The stub comes too late for the preview worker, which answers next/ from its cache instead, so the stub's own
      // script and redirect never run. Routes see a worker's own fetches, but the browser's update check, which fetches
      // the retiring worker, may bypass them, so this case routes only the page.
      let stubRequests = 0;
      await context.route(nextOf(site), async (route) => {
        stubRequests += 1;
        await delay(SLOW_STUB_MS);
        await route.continue().catch(() => undefined);
      });

      await page.goto(nextOf(site));
      await expect(page.getByRole('heading', { name: 'Preview build' }), 'the preview worker answers from its cache').toBeVisible();
      expect(stubRequests, 'the preview worker asked the network for the stub first').toBeGreaterThan(0);

      await expectMovedToRoot(page, site, SLOW_MOVE_TIMEOUT_MS);
      await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
    });

    test('the next deploy replaces the root cache with its own and still plays offline', async ({ page, context, serve }) => {
      const site = await serve(reveal);
      await visitRoot(page, site);
      const version = await rootVersion(page);

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

    test('after the next deploy, the game page comes from it, even while the HTTP cache still holds the last one', async ({ page, serve }, testInfo) => {
      const cachedAsPages = (dir: string): PagesMount[] => [{ dir, at: './', maxAge: PAGES_MAX_AGE_SECONDS }];
      const site = await serve(cachedAsPages(DIST));
      await visitRoot(page, site);
      const version = await rootVersion(page);
      // A link with a query is the game's page too, which the worker answers; the HTTP cache now holds it for ten
      // minutes. Installing the next deploy's worker refreshes only the copies it precaches, never this one.
      const linked = new URL('?from=link', site.url).href;
      await page.goto(linked);
      await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();

      const nextDeploy = testInfo.outputPath('next-deploy');
      writeNextDeploy(nextDeploy, version);
      site.setMounts(cachedAsPages(nextDeploy));
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await expect.poll(() => cachesNamed(page, ROOT_CACHE_PREFIX), { message: 'the next deploy\'s worker has taken over' }).toEqual([
        `${ROOT_CACHE_PREFIX}${version}b`,
      ]);

      // Ordinary navigations, each to an address other than the current one: a reload would revalidate by itself.
      for (const address of [site.url, linked]) {
        await page.goto(address);
        await expect(page.locator('meta[name="deploy"]'), `${address} shows the next deploy's page`).toHaveAttribute('content', 'next');
        await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
      }
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
