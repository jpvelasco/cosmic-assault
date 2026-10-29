import type { Page } from '@playwright/test';
import { IOS_INSTALL_HINT } from '../src/ui/hints';
import { expect, test } from './fixtures';

// No test here needs the test bridge. The release build (projects release-smoke and pages) runs only the @release
// one: the install metadata it ships. The chip's behaviour is the same in both builds, so chromium-desktop alone covers it.

const offer = (page: Page) => page.getByTestId('install-offer');

/** The page's window, counting how often the synthetic install prompt's `prompt()` has been called. */
type CountingWindow = Window & { installPrompts?: number };

/** Opens the title card; the browser's own install prompt, if it sends one, never reaches the game. */
async function openTitle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener(
      'beforeinstallprompt',
      (e) => {
        if (e.isTrusted) e.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.goto('./');
  await expect(page.getByTestId('build-label')).toBeVisible();
}

/** Sends the page a `beforeinstallprompt` as Chromium would, whose `prompt()` only counts its calls before the player gives `outcome`. */
async function sendInstallPrompt(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted'): Promise<void> {
  await page.evaluate((choice) => {
    const counting: CountingWindow = window;
    counting.installPrompts = 0;
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: () => {
        counting.installPrompts = (counting.installPrompts ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: choice, platform: '' }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

const promptCalls = (page: Page): Promise<number | undefined> => page.evaluate(() => (window as CountingWindow).installPrompts);

test('a browser install prompt brings an Install chip that opens it, then goes', async ({ page }) => {
  await openTitle(page);
  await sendInstallPrompt(page);

  await expect(offer(page)).toHaveText('Install');
  await expect(offer(page)).not.toHaveAttribute('aria-pressed');
  await offer(page).click();
  expect(await promptCalls(page)).toBe(1);
  await expect(offer(page)).toHaveCount(0);
  await expect(page.getByTestId('build-label'), 'the click did not start a run').toBeVisible();
});

test('arrow keys reach the Install chip, and Enter on it opens the prompt without starting a run', async ({ page }) => {
  await openTitle(page);
  await sendInstallPrompt(page);
  await page.getByTestId('records-open').focus();

  // The Hangar chip sits between Records and the offer.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('hangar-open')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(offer(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => promptCalls(page)).toBe(1);
  await expect(page.getByTestId('build-label')).toBeVisible();
  // The installed chip goes, and focus moves to its neighbour instead of dropping to the page, where Space would start a run.
  await expect(offer(page)).toHaveCount(0);
  await expect(page.getByTestId('hangar-open')).toBeFocused();
});

test('a dismissed prompt keeps the Install chip for another try', async ({ page }) => {
  await openTitle(page);
  await sendInstallPrompt(page, 'dismissed');

  await offer(page).click();
  await expect.poll(() => promptCalls(page)).toBe(1);
  await expect(offer(page)).toHaveText('Install');
});

test('the installed app offers nothing, even when a prompt arrives', async ({ page }) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => matchMedia(query === '(display-mode: standalone)' ? 'all' : query);
  });
  await openTitle(page);
  await sendInstallPrompt(page);

  await expect(offer(page)).toHaveCount(0);
});

test.describe('in iOS Safari', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('the title card says how to add the game to the home screen, as text rather than a button', async ({ page }) => {
    await openTitle(page);

    await expect(offer(page)).toHaveText(IOS_INSTALL_HINT);
    expect(await offer(page).evaluate((el) => el.tagName)).toBe('P');
    await expect(page.getByRole('button', { name: /Home Screen/ })).toHaveCount(0);
  });
});

test('the manifest link and every icon it lists resolve', { tag: '@release' }, async ({ page, request }) => {
  await openTitle(page);
  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((link: HTMLLinkElement) => link.href);
  const touchIconUrl = await page.locator('link[rel="apple-touch-icon"]').evaluate((link: HTMLLinkElement) => link.href);

  const response = await request.get(manifestUrl);
  expect(response.status(), manifestUrl).toBe(200);
  const { icons } = (await response.json()) as { icons: { src: string }[] };
  expect(icons.length).toBeGreaterThan(0);
  const iconUrls = [touchIconUrl, ...icons.map((icon) => new URL(icon.src, manifestUrl).href)];
  // Each resolves inside the page's own directory, so under a project path none of them leaves the site.
  const site = new URL('./', page.url()).href;
  expect([manifestUrl, ...iconUrls].filter((url) => !url.startsWith(site)), `addresses outside ${site}`).toEqual([]);
  for (const url of iconUrls) {
    const icon = await request.get(url);
    expect(icon.status(), url).toBe(200);
    expect(icon.headers()['content-type'], url).toBe('image/png');
  }
});
