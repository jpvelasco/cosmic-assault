import type { Page } from '@playwright/test';
import { expect, expectMode, gameState, nextFrames, openGame, shipState, test } from './fixtures';

/** Standard-mapping button indices. */
const A = 0;
const B = 1;
const RT = 7;
const START = 9;
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_RIGHT = 15;

interface FakePad {
  connected: boolean;
  buttons: { pressed: boolean }[];
  axes: number[];
}

/** A pad the page sees through `navigator.getGamepads`, which a test works by changing the flags on `window.__fakePad`. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const fake: FakePad = {
      connected: true,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
      axes: [0, 0, 0, 0],
    };
    const pad = { id: 'fake', index: 0, mapping: 'standard', connected: true, axes: fake.axes, buttons: fake.buttons };
    (window as unknown as { __fakePad: FakePad }).__fakePad = fake;
    navigator.getGamepads = () => (fake.connected ? [pad as unknown as Gamepad, null, null, null] : [null, null, null, null]);
  });
  await openGame(page);
});

function setButton(page: Page, index: number, pressed: boolean): Promise<void> {
  return page.evaluate(
    ([i, down]) => {
      const pad = (window as unknown as { __fakePad: FakePad }).__fakePad;
      const button = pad.buttons[i as number];
      if (button !== undefined) button.pressed = down as boolean;
    },
    [index, pressed],
  );
}

/** Presses and releases a button, leaving a frame on each side so the game sees both. */
async function tap(page: Page, index: number): Promise<void> {
  await setButton(page, index, true);
  await nextFrames(page);
  await setButton(page, index, false);
  await nextFrames(page);
}

function disconnect(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __fakePad: FakePad }).__fakePad.connected = false;
  });
}

async function startRun(page: Page): Promise<void> {
  await tap(page, A);
  await expectMode(page, 'playing');
}

test('A on the title starts a run', async ({ page }) => {
  await expectMode(page, 'title');
  await startRun(page);
});

test('holding the right trigger fires', async ({ page }) => {
  await startRun(page);
  expect((await gameState(page)).projectileCount).toBe(0);

  await setButton(page, RT, true);
  await expect.poll(async () => (await gameState(page)).projectileCount, { timeout: 5000 }).toBeGreaterThan(0);
  await setButton(page, RT, false);
});

test('D-pad up thrusts, and disconnecting the pad mid-thrust stops it', async ({ page }) => {
  await startRun(page);

  await setButton(page, DPAD_UP, true);
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(true);

  await disconnect(page);
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(false);
});

test('the left stick points the ship where it is pushed and thrusts, like the touch joystick', async ({ page }) => {
  await startRun(page);
  await page.evaluate(() => {
    (window as unknown as { __fakePad: FakePad }).__fakePad.axes[1] = 1;
  });

  // Straight down on screen is angle pi/2.
  await expect.poll(async () => (await shipState(page)).angle).toBeCloseTo(Math.PI / 2, 1);
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(true);
});

test('Start pauses and resumes, and B resumes from the pause card', async ({ page }) => {
  await startRun(page);

  await tap(page, START);
  await expectMode(page, 'paused');
  await tap(page, START);
  await expectMode(page, 'playing');

  await tap(page, START);
  await expectMode(page, 'paused');
  await tap(page, B);
  await expectMode(page, 'playing');
});

test('on the title the arrow keys move focus instead of starting, and A presses the focused chip', async ({ page }) => {
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeFocused();
  await nextFrames(page, 3);
  await expectMode(page, 'title');

  await tap(page, A);
  expect((await gameState(page)).practiceLevel).toBe(2);
  await expectMode(page, 'title');
});

test('the D-pad walks down from the level chips to the settings chip, and A opens it', async ({ page }) => {
  await tap(page, DPAD_DOWN);
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeFocused();

  await tap(page, DPAD_DOWN);
  await expect(page.getByTestId('sound-toggle')).toBeFocused();
  // The chips row holds the sound, full screen (where the browser has it) and settings chips, left to right.
  const settingsChip = page.getByTestId('settings-open');
  for (let step = 0; step < 2 && !(await settingsChip.evaluate((el) => el === document.activeElement)); step++) {
    await tap(page, DPAD_RIGHT);
  }
  await expect(settingsChip).toBeFocused();
  await tap(page, A);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('in settings the D-pad adjusts a slider and B closes the card', async ({ page }) => {
  await page.getByTestId('settings-open').click();
  const music = page.getByTestId('settings-music');
  await expect(music).toBeFocused();
  await expect(music).toHaveValue('60');

  await tap(page, DPAD_RIGHT);
  await expect(music).toHaveValue('65');
  await expect.poll(async () => (await gameState(page)).settings.musicVolume).toBe(0.65);

  await tap(page, B);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await expectMode(page, 'title');
});
