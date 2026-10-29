import type { Page } from '@playwright/test';
import { SOUND_GESTURE_HINT } from '../src/ui/hints';
import { TOAST_MS } from '../src/ui/toast';
import { defaultSave } from '../src/meta/save';
import { DAILY_GAME_OVER_SECONDS, dateFor, PHONE_PORTRAIT_VIEWPORT } from './seeds';
import { expect, expectDemoEndedOnTitle, expectMode, fastForward, gameState, installFakePad, nextFrames, openDaily, openGame, PAD, seedSave, setPadButton, shipState, startAttract, tapPad, test, threeStarSave, toastOf, waitOutGameOverGuard, type FakePad } from './fixtures';

const { A, B, RT, START, DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT } = PAD;

// The pad reads the same on every screen, so these run on the desktop only (@desktop); the phone runs the one test
// that needs its rotate prompt (@phone). See the project filters in playwright.config.ts.

test.beforeEach(async ({ page }) => {
  await installFakePad(page);
  await page.addInitScript(() => {
    // No full screen chip, so the title's chip row is always Sound then Settings.
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { value: false, configurable: true });
  });
  await openGame(page);
});

/** Pushes the left stick to `x` across, centred up and down. */
function setStickX(page: Page, x: number): Promise<void> {
  return page.evaluate((value) => {
    (window as unknown as { __fakePad: FakePad }).__fakePad.axes[0] = value;
  }, x);
}

function disconnect(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __fakePad: FakePad }).__fakePad.connected = false;
  });
}

async function startRun(page: Page): Promise<void> {
  await tapPad(page, A);
  await expectMode(page, 'playing');
}

test('A on the title starts a run', { tag: '@desktop' }, async ({ page }) => {
  await expectMode(page, 'title');
  await startRun(page);
});

test('the first A with sound still locked says how to turn it on, once', { tag: '@desktop' }, async ({ page }) => {
  const toast = toastOf(page);
  await startRun(page);
  // A pad press is no user activation, so the browser keeps sound off until a tap or key press.
  expect((await gameState(page)).audioState).toBe('none');
  await expect(toast).toHaveText(SOUND_GESTURE_HINT);
  await expect(toast).toHaveText('', { timeout: TOAST_MS * 3 });

  await tapPad(page, START);
  await expectMode(page, 'paused');
  await tapPad(page, A);
  await expectMode(page, 'playing');
  await nextFrames(page, 3);
  await expect(toast).toHaveText('');
});

test('holding the right trigger fires', { tag: '@desktop' }, async ({ page }) => {
  await startRun(page);
  expect((await gameState(page)).projectileCount).toBe(0);

  await setPadButton(page, RT, true);
  await expect.poll(async () => (await gameState(page)).projectileCount, { timeout: 5000 }).toBeGreaterThan(0);
  await setPadButton(page, RT, false);
});

test('D-pad up thrusts, and disconnecting the pad mid-thrust stops it', { tag: '@desktop' }, async ({ page }) => {
  await startRun(page);

  await setPadButton(page, DPAD_UP, true);
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(true);

  await disconnect(page);
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(false);
});

test('the left stick points the ship where it is pushed and thrusts, like the touch joystick', { tag: '@desktop' }, async ({ page }) => {
  await startRun(page);
  await page.evaluate(() => {
    (window as unknown as { __fakePad: FakePad }).__fakePad.axes[1] = 1;
  });

  // Straight down on screen is angle pi/2.
  await expect.poll(async () => (await shipState(page)).angle).toBeCloseTo(Math.PI / 2, 1);
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(true);
});

test('pad A ends the attract demo and presses nothing, held or let go; the next A plays', { tag: '@desktop' }, async ({ page }) => {
  await startAttract(page);
  await setPadButton(page, A, true);
  await expectDemoEndedOnTitle(page);
  await setPadButton(page, A, false);
  await nextFrames(page);
  expect((await gameState(page)).screen).toBe('title');
  // The press that ended the demo spent nothing: the one-time sound hint waits for the A that plays.
  expect(await toastOf(page).textContent()).toBe('');
  await startRun(page);
  await expect(toastOf(page)).toHaveText(SOUND_GESTURE_HINT);
});

test('a stick pushed just past its dead zone ends the attract demo and moves nothing; the next A plays', { tag: '@desktop' }, async ({ page }) => {
  await startAttract(page);
  await setStickX(page, 0.3);
  await expectDemoEndedOnTitle(page);
  await setStickX(page, 0);
  await nextFrames(page);
  await startRun(page);
});

test('Start pauses and resumes, and B resumes from the pause card', { tag: '@desktop' }, async ({ page }) => {
  await startRun(page);

  await tapPad(page, START);
  await expectMode(page, 'paused');
  await tapPad(page, START);
  await expectMode(page, 'playing');

  await tapPad(page, START);
  await expectMode(page, 'paused');
  await tapPad(page, B);
  await expectMode(page, 'playing');
});

test('on the title the arrow keys move focus instead of starting, and A presses the focused chip', { tag: '@desktop' }, async ({ page }) => {
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('play')).toBeFocused();
  // Down lands on the chip under Play, Settings; the sound chip is to its left.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('settings-open')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('sound-toggle')).toBeFocused();
  await nextFrames(page, 3);
  await expectMode(page, 'title');

  await tapPad(page, A);
  expect((await gameState(page)).muted).toBe(true);
  await expectMode(page, 'title');
});

test('the D-pad walks from Play down to Settings and across to Records, A opens it, and B closes it', { tag: '@desktop' }, async ({ page }) => {
  await tapPad(page, DPAD_DOWN);
  await expect(page.getByTestId('play')).toBeFocused();

  await tapPad(page, DPAD_DOWN);
  await expect(page.getByTestId('settings-open')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('records-open')).toBeFocused();
  await tapPad(page, A);
  await expect(page.getByTestId('records')).toBeVisible();
  await expect(page.getByTestId('records-back')).toBeFocused();
  // Under the card A presses its Back, and B closes it too: both return to the chip.
  await tapPad(page, A);
  await expect(page.getByTestId('records')).toBeHidden();
  await expect(page.getByTestId('records-open')).toBeFocused();
  await tapPad(page, A);
  await expect(page.getByTestId('records')).toBeVisible();
  await tapPad(page, B);
  await expect(page.getByTestId('records')).toBeHidden();
  await expectMode(page, 'title');
});

test('the D-pad reaches the Hangar after Records, A opens it, the D-pad moves within it, A picks a look, and B closes it', { tag: '@desktop' }, async ({ page }) => {
  // Fifteen stars: the Comet trail is unlocked, and not yet chosen.
  await seedSave(page, threeStarSave(['1-1', '1-2', '1-3', '1-4', '1-5']));
  await openGame(page);
  await tapPad(page, DPAD_DOWN);
  await tapPad(page, DPAD_DOWN);
  await expect(page.getByTestId('settings-open')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('records-open')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('hangar-open')).toBeFocused();
  await tapPad(page, A);
  const hangar = page.getByTestId('hangar');
  await expect(hangar).toBeVisible();
  await expect(page.getByTestId('hangar-skin-classic')).toBeFocused();
  await tapPad(page, DPAD_DOWN);
  await expect(page.getByTestId('hangar-trail-standard')).toBeFocused();
  // The D-pad moves focus onto the Comet without choosing it, so only A can.
  await tapPad(page, DPAD_RIGHT);
  const comet = page.getByTestId('hangar-trail-comet');
  await expect(comet).toBeFocused();
  expect((await gameState(page)).settings.trail).toBe('standard');
  await tapPad(page, A);
  await expect.poll(async () => (await gameState(page)).settings.trail).toBe('comet');
  await expect(comet).toBeChecked();
  await expect(hangar).toBeVisible();
  // B closes the card with focus back on its chip.
  await tapPad(page, B);
  await expect(hangar).toBeHidden();
  await expect(page.getByTestId('hangar-open')).toBeFocused();
  await expectMode(page, 'title');
});

test('in settings the D-pad adjusts a slider and B closes the card', { tag: '@desktop' }, async ({ page }) => {
  await page.getByTestId('settings-open').click();
  const music = page.getByTestId('settings-music');
  await expect(music).toBeFocused();
  await expect(music).toHaveValue('60');

  await tapPad(page, DPAD_RIGHT);
  await expect(music).toHaveValue('65');
  await expect.poll(async () => (await gameState(page)).settings.musicVolume).toBe(0.65);

  await tapPad(page, B);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await expectMode(page, 'title');
});

test('Start starts a run from the title', { tag: '@desktop' }, async ({ page }) => {
  await tapPad(page, START);
  await expectMode(page, 'playing');
});

test('pad navigation shows the focus ring even after a mouse click, until the next pointer press', { tag: '@desktop' }, async ({ page }) => {
  const sound = page.getByTestId('sound-toggle');
  const outline = () => sound.evaluate((el) => getComputedStyle(el).outlineStyle);
  // A click on a chip does not take focus, so the pad starts from the first control.
  await sound.click();
  await tapPad(page, DPAD_DOWN);
  await tapPad(page, DPAD_DOWN);
  await tapPad(page, DPAD_LEFT);
  await expect(sound).toBeFocused();
  expect(await outline()).toBe('solid');

  await sound.click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('nav-keys'))).toBe(false);
  expect(await outline()).toBe('none');
});

test('on mode select A focuses the first button, A presses it, and B goes back a screen', { tag: '@desktop' }, async ({ page }) => {
  await openGame(page, { galaxy: null });
  await tapPad(page, A);
  await expectMode(page, 'modeSelect');

  await tapPad(page, A);
  await expect(page.getByTestId('mode-rank')).toBeFocused();
  await expectMode(page, 'modeSelect');
  // Free play's card sits to the right of Rank's.
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('mode-free')).toBeFocused();
  await tapPad(page, A);
  await expectMode(page, 'map');

  await tapPad(page, B);
  await expectMode(page, 'modeSelect');
  await tapPad(page, B);
  await expectMode(page, 'title');
});

test('the D-pad reaches the Daily card, A plays it, and A after its game over plays the same date again', { tag: '@desktop' }, async ({ page }) => {
  const date = dateFor('daily-game-over');
  await openDaily(page, date);
  await tapPad(page, A);
  await expectMode(page, 'modeSelect');
  await tapPad(page, A);
  await tapPad(page, DPAD_RIGHT);
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('mode-daily')).toBeFocused();
  await tapPad(page, A);
  await expectMode(page, 'playing');
  expect((await gameState(page)).daily?.date).toBe(date);

  await fastForward(page, DAILY_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await waitOutGameOverGuard(page);
  await tapPad(page, A);
  await expectMode(page, 'playing');
  expect((await gameState(page)).daily?.date).toBe(date);
});

test('behind the settings card the pad can only reach the card, and Start does not begin a run', { tag: '@desktop' }, async ({ page }) => {
  await page.getByTestId('settings-open').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();

  for (const button of [DPAD_DOWN, DPAD_DOWN, DPAD_DOWN, DPAD_DOWN, DPAD_DOWN, DPAD_DOWN]) {
    await tapPad(page, button);
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await tapPad(page, START);
  await nextFrames(page, 3);
  await expectMode(page, 'title');
});

test('the rotate prompt covers every card: the pad focuses nothing and cannot start a run', { tag: '@phone' }, async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT_VIEWPORT);
  await expect(page.getByTestId('rotate-prompt')).toBeVisible();

  await tapPad(page, DPAD_DOWN);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await tapPad(page, A);
  await tapPad(page, START);
  await nextFrames(page, 3);
  await expectMode(page, 'title');
});

test('the D-pad walks the three side-by-side mode cards and the row of Dimensions, skipping the locked ones', { tag: '@desktop' }, async ({ page }) => {
  await seedSave(page, { ...defaultSave(), frontier: '2-1' });
  await openGame(page, { galaxy: null });
  await tapPad(page, A);
  await expectMode(page, 'modeSelect');
  await tapPad(page, A);
  await expect(page.getByTestId('mode-rank')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('mode-free')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('mode-daily')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('mode-daily')).toBeFocused();
  await tapPad(page, DPAD_LEFT);
  await expect(page.getByTestId('mode-free')).toBeFocused();
  await tapPad(page, DPAD_LEFT);
  await expect(page.getByTestId('mode-rank')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await tapPad(page, A);
  await expectMode(page, 'map');

  await tapPad(page, A);
  await expect(page.getByTestId('dimension-1')).toBeFocused();
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('dimension-2')).toBeFocused();
  // D3 to D5 are locked.
  await tapPad(page, DPAD_RIGHT);
  await expect(page.getByTestId('dimension-2')).toBeFocused();
  await tapPad(page, DPAD_DOWN);
  await expect(page.getByTestId('back')).toBeFocused();
  await tapPad(page, A);
  await expectMode(page, 'modeSelect');
});
