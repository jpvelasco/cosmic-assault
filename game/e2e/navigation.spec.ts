import type { Locator, Page } from '@playwright/test';
import { expect, expectMode, gameState, nextFrames, openGame, test } from './fixtures';

// One way to pause and one pause card on every device: these run on the desktop and the phone alike.

const pauseButton = (page: Page) => page.getByRole('button', { name: 'Pause' });
const resume = (page: Page) => page.getByTestId('resume');
const quit = (page: Page) => page.getByTestId('quit');
const settingsChip = (page: Page) => page.getByTestId('settings-open');
const settingsCard = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

/** A press as the device makes one: a tap on a phone, a click at a desk. */
const press = (locator: Locator, isMobile: boolean): Promise<void> => (isMobile ? locator.tap() : locator.click());

/** Starts the `?galaxy=` run by pressing Play, without a key. */
async function playByPointer(page: Page, isMobile: boolean): Promise<void> {
  await press(page.getByTestId('play'), isMobile);
  await expectMode(page, 'playing');
}

const shots = async (page: Page): Promise<number> => (await gameState(page)).events.shot ?? 0;

test('the Pause button shows in play on every device, clear of the HUD, and a press on it pauses without a shot', async ({ page, isMobile }) => {
  await openGame(page);
  await expect(pauseButton(page)).toBeHidden();
  await playByPointer(page, isMobile);
  await nextFrames(page, 3);

  await expect(pauseButton(page)).toBeVisible();
  // The joystick and FIRE stay a touch screen's.
  await expect(page.getByTestId('touch-joystick')).toBeVisible({ visible: isMobile });
  // Keys get a tooltip naming them; a phone has none to show.
  await expect(pauseButton(page)).toHaveAttribute('title', isMobile ? '' : 'Pause (Esc or P)');
  const box = await pauseButton(page).boundingBox();
  if (box === null) throw new Error('The pause button has no layout box in play');
  const { hudRects } = await gameState(page);
  expect(hudRects.length).toBeGreaterThan(0);
  for (const rect of hudRects) {
    const clear = rect.x + rect.width <= box.x || rect.y >= box.y + box.height;
    expect(clear, `HUD pill ${JSON.stringify(rect)} is clear of the pause button`).toBe(true);
  }

  await press(pauseButton(page), isMobile);
  await expectMode(page, 'paused');
  await expect(pauseButton(page)).toBeHidden();
  await nextFrames(page, 3);
  expect(await shots(page)).toBe(0);
  if (!isMobile) await expect(resume(page)).toBeFocused();
  await expect(quit(page)).toHaveText('Quit to title');

  await press(resume(page), isMobile);
  await expectMode(page, 'playing');
});

test('the pause card opens with Resume focused, so Enter or Space resumes, from Esc or a lost focus', async ({ page, isMobile }) => {
  await openGame(page);
  await playByPointer(page, isMobile);

  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await expect(resume(page)).toBeFocused();
  // The key beside Resume is for keys only; its name stays "Resume".
  await expect(resume(page)).toHaveAccessibleName('Resume');
  await expect(resume(page).locator('.key-hint')).toBeVisible({ visible: !isMobile });
  await expect(page.getByTestId('pause-hint')).toBeVisible({ visible: !isMobile });
  await page.keyboard.press('Enter');
  await expectMode(page, 'playing');

  // A pause on its own (the window lost focus) offers the same.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectMode(page, 'paused');
  await expect(resume(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await nextFrames(page, 3);
  expect(await shots(page), 'the Space that resumed fired nothing').toBe(0);
});

test('Space held as the run pauses does not resume when let go, and leaves no fire held @desktop', async ({ page }) => {
  await openGame(page);
  await playByPointer(page, false);
  await page.keyboard.down('Space');
  await expect.poll(() => shots(page)).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await expect(resume(page)).toBeFocused();
  // A held key repeats onto the focused Resume, then lets go there.
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await nextFrames(page, 3);
  await expectMode(page, 'paused');

  await page.keyboard.press('Enter');
  await expectMode(page, 'playing');
  await nextFrames(page, 3);
  const before = await shots(page);
  await nextFrames(page, 30);
  expect(await shots(page), 'no fire is held after the pause').toBe(before);
});

test('a Rank Quit asks twice, and Esc takes the question back without resuming', async ({ page, isMobile }) => {
  await openGame(page, { lives: 3 });
  await playByPointer(page, isMobile);
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await expect(quit(page)).toHaveText('Quit (costs a life)');

  await press(quit(page), isMobile);
  await expect(quit(page)).toHaveText('Really quit? Costs a life');
  await nextFrames(page, 3);
  await expectMode(page, 'paused');

  await page.keyboard.press('Escape');
  await expect(quit(page)).toHaveText('Quit (costs a life)');
  await nextFrames(page, 3);
  await expectMode(page, 'paused');

  await press(quit(page), isMobile);
  await press(quit(page), isMobile);
  await expectMode(page, 'title');
});

test('with keys, a Rank Quit keeps its focus between the two presses @desktop', async ({ page }) => {
  await openGame(page, { lives: 3 });
  await playByPointer(page, false);
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await page.keyboard.press('ArrowDown');
  await expect(quit(page)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(quit(page)).toHaveText('Really quit? Costs a life');
  await expect(quit(page)).toBeFocused();
  await expectMode(page, 'paused');
  await page.keyboard.press('Enter');
  await expectMode(page, 'title');
});

test('Settings opens from mode select and closes back to it, focus on its chip', async ({ page, isMobile }) => {
  await openGame(page, { galaxy: null });
  await press(page.getByTestId('play'), isMobile);
  await expectMode(page, 'modeSelect');

  await press(settingsChip(page), isMobile);
  await expect(settingsCard(page)).toBeVisible();
  await nextFrames(page, 3);
  await expectMode(page, 'modeSelect');
  await press(settingsCard(page).getByRole('button', { name: 'Done' }), isMobile);
  await expect(settingsCard(page)).toBeHidden();
  await expectMode(page, 'modeSelect');
  await expect(settingsChip(page)).toBeFocused();

  // Esc closes the card alone: mode select stays.
  await press(settingsChip(page), isMobile);
  await expect(settingsCard(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsCard(page)).toBeHidden();
  await nextFrames(page, 3);
  await expectMode(page, 'modeSelect');
  await expect(settingsChip(page)).toBeFocused();
});
