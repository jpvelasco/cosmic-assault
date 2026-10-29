import type { Page } from '@playwright/test';
import { askForAttract, attractState, expect, expectDemoEndedOnTitle, expectMode, gameState, nextFrames, openGame, startAttract, test } from './fixtures';

/** The demo the cycle plays first. */
const FIRST_DEMO = '1-3';

/** Every key `localStorage` holds, with its value. */
const storageOf = (page: Page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));

/** The phone size the owner checks layouts at, on its side. */
const PHONE_VIEWPORT = { width: 844, height: 390 };

test('the demo plays behind the dimmed title card with its Demo label and no HUD, and leaves storage as it was', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize(PHONE_VIEWPORT);
  await openGame(page);
  const before = await storageOf(page);
  await expect(page.getByTestId('demo-label')).toBeHidden();
  await startAttract(page);
  expect(await attractState(page)).toMatchObject({ active: true, demo: FIRST_DEMO, halted: false });
  const title = page.locator('.overlay--title');
  await expect(title).toHaveClass(/title--attract/);
  await expect(page.getByTestId('demo-label')).toBeVisible();
  // Decoration only: a screen reader reads the title, not the pill.
  await expect(page.getByTestId('demo-label')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('play')).toBeVisible();
  // Polled: the card may still be popping in.
  await expect.poll(() => title.locator('.card').evaluate((card) => getComputedStyle(card).opacity)).toBe('0.85');
  // The title's own sky gives way, so the demo on the canvas shows through.
  expect(await title.evaluate((panel) => getComputedStyle(panel).backgroundImage)).toBe('none');
  const state = await gameState(page);
  expect(state.screen).toBe('title');
  expect(state.hudRects).toEqual([]);
  await expect.poll(async () => (await attractState(page)).frames).toBeGreaterThan(state.attract?.frames ?? 0);
  await page.screenshot({ path: testInfo.outputPath(`attract-${testInfo.project.name}.png`) });
  const playDuringDemo = await page.getByTestId('play').boundingBox();

  await page.keyboard.press('KeyM');
  await expectDemoEndedOnTitle(page);
  await expect(title).not.toHaveClass(/title--attract/);
  await expect(page.getByTestId('demo-label')).toBeHidden();
  // The label sits out of the card's flow, so a press aimed at Play as the demo ends finds it where it was.
  expect(await page.getByTestId('play').boundingBox()).toEqual(playDuringDemo);
  // M only ended the demo: sound is as it was, and nothing was saved.
  expect((await gameState(page)).muted).toBe(false);
  expect(await storageOf(page)).toBe(before);
});

for (const [name, key, focusPlay] of [
  ['Enter on the focused Play button', 'Enter', true],
  ['Space', 'Space', false],
  ['ArrowUp', 'ArrowUp', false],
] as const) {
  test(`${name} ends the demo and does nothing else, held or let go; the next press plays`, { tag: '@desktop' }, async ({ page }) => {
    await openGame(page);
    const play = page.getByTestId('play');
    if (focusPlay) await play.focus();
    await startAttract(page);
    await page.keyboard.down(key);
    await expectDemoEndedOnTitle(page);
    // A second keydown of a held key is its auto-repeat.
    await page.keyboard.down(key);
    await nextFrames(page, 3);
    expect((await gameState(page)).screen).toBe('title');
    if (focusPlay) await expect(play).toBeFocused();
    await page.keyboard.up(key);
    await nextFrames(page);
    expect((await gameState(page)).screen).toBe('title');
    await page.keyboard.press(focusPlay ? 'Enter' : 'Space');
    await expectMode(page, 'playing');
  });
}

for (const [name, target] of [
  ['Play', (page: Page) => page.getByTestId('play')],
  ['the title card beside its buttons', (page: Page) => page.getByRole('heading', { name: 'Cosmic Assault' })],
] as const) {
  test(`a tap or click on ${name} ends the demo and presses nothing; the next one plays`, async ({ page, isMobile }) => {
    await openGame(page);
    const press = () => (isMobile ? target(page).tap() : target(page).click());
    await startAttract(page);
    await press();
    await expectDemoEndedOnTitle(page);
    await press();
    await expectMode(page, 'playing');
  });
}

test('never plays under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  await askForAttract(page);
  await nextFrames(page, 10);
  expect(await attractState(page)).toMatchObject({ active: false, frames: 0 });
});

test('stops when reduced motion turns on mid-demo', async ({ page }) => {
  await openGame(page);
  await startAttract(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await attractState(page)).active).toBe(false);
});

test('never plays with the records card over the title', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('records-open').click();
  await askForAttract(page);
  await nextFrames(page, 10);
  expect((await attractState(page)).active).toBe(false);
});

test('stops when the window turns upright', { tag: '@desktop' }, async ({ page }) => {
  await openGame(page);
  await startAttract(page);
  await page.setViewportSize({ width: 600, height: 900 });
  await expect.poll(async () => (await attractState(page)).active).toBe(false);
  expect((await gameState(page)).screen).toBe('title');
});
