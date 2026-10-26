import type { Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/app/settings';
import { DELIBERATE_CRASH } from '../src/testBridge';
import { expect, expectMode, gameState, nextFrames, openGame, test } from './fixtures';


test.use({ allowedErrors: [DELIBERATE_CRASH] });

async function crash(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__COSMIC_ASSAULT_TEST_API__?.crash();
  });
}

const card = (page: Page) => page.getByRole('alertdialog', { name: 'Something went wrong' });

test('a crash mid-run shows the recovery card, stops drawing and logs the error', async ({ page, consoleErrors }, testInfo) => {
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  const before = (await gameState(page)).logSize;
  await crash(page);

  await expect(card(page)).toBeVisible();
  await expect(page.getByText('The game hit an error and stopped. Your settings are safe.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('crash.png') });

  const afterCrash = (await gameState(page)).logSize;
  expect(afterCrash).toBeGreaterThan(before);
  // Losing focus would pause a live run; after a crash the log and the reported mode stay as they were.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await gameState(page)).toMatchObject({ logSize: afterCrash, mode: 'playing' });
  const drawn = (await gameState(page)).drawCount;
  await nextFrames(page, 3);
  expect((await gameState(page)).drawCount).toBe(drawn);
  expect(consoleErrors.filter((message) => message.includes(DELIBERATE_CRASH))).toHaveLength(1);
});

test('a crash silences audio without changing the saved settings', async ({ page }) => {
  const saved = { muted: false, musicVolume: 0.3, sfxVolume: 0.4 };
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value);
  }, [SETTINGS_KEY, JSON.stringify(saved)] as const);
  await openGame(page);
  await crash(page);
  await expect(card(page)).toBeVisible();

  expect((await gameState(page)).muted).toBe(true);
  const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
  expect(JSON.parse(stored ?? 'null')).toEqual(saved);
});

test('Tab stays inside the crash card', async ({ page }) => {
  await openGame(page);
  await crash(page);
  const tryAgain = page.getByRole('button', { name: 'Try again' });
  const copy = page.getByRole('button', { name: 'Copy report' });
  await expect(tryAgain).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(copy).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tryAgain).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(copy).toBeFocused();
});

test('Copy report puts the log, with the error in it, on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await crash(page);
  await page.getByRole('button', { name: 'Copy report' }).click();

  const toast = page.getByRole('status');
  await expect(toast).toHaveText('Report copied');
  // Visible to the player, not just present: the toast is the topmost element at its own centre, above the card's
  // backdrop. Hit testing skips `pointer-events: none`, so the probe lets the toast take hits for the one lookup.
  const onTop = await toast.evaluate((el) => {
    const box = el.getBoundingClientRect();
    el.style.pointerEvents = 'auto';
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    el.style.pointerEvents = '';
    return top === el;
  });
  expect(onTop, 'the toast is drawn above the crash card').toBe(true);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const report = JSON.parse(text) as { meta: Record<string, string>; entries: { kind: string; message: string }[] };
  expect(report.meta['build']).toMatch(/^preview · /);
  expect(report.meta['mode']).toBe('playing');
  expect(report.entries.some((entry) => entry.kind === 'mode' && entry.message === 'playing')).toBe(true);
  expect(report.entries.some((entry) => entry.kind === 'error' && entry.message.includes(DELIBERATE_CRASH))).toBe(true);
});

test('Copy report falls back to a selected read-only box when the clipboard refuses', async ({ page }) => {
  await openGame(page);
  await crash(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
  });
  await page.getByRole('button', { name: 'Copy report' }).click();

  const box = page.getByLabel('Report text, selected for copying');
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('readonly', '');
  await expect(box).toBeFocused();
  expect(await box.inputValue()).toContain(DELIBERATE_CRASH);
  const selected = await box.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart);
  expect(selected).toBe((await box.inputValue()).length);
});

test('Try again reloads to the title', async ({ page }) => {
  await openGame(page);
  await crash(page);
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();

  await page.waitForFunction(() => window.__COSMIC_ASSAULT_TEST_API__?.version === 3);
  await expect(card(page)).toBeHidden();
  await expect(page.getByText('Press Space to start')).toBeVisible();
  expect((await gameState(page)).mode).toBe('title');
});
