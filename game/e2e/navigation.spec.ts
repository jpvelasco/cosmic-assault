import type { Locator, Page } from '@playwright/test';
import { hintCopy } from '../src/ui/hints';
import {
  expect,
  expectMode,
  fastForward,
  gameState,
  installFakePad,
  nextFrames,
  openGame,
  openGameOverRun,
  openModeSelect,
  PAD,
  shotsFired,
  startRun,
  tapPad,
  test,
  waitForGameOver,
  waitOutGameOverGuard,
} from './fixtures';
import { FREE_GAME_OVER_SECONDS, GAME_OVER_GALAXY, seedFor } from './seeds';

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
  expect(await shotsFired(page)).toBe(0);
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
  // Esc was the last input, so the keys show beside Resume and under it, on a phone too.
  await expect(resume(page).locator('.key-hint')).toHaveText('Esc');
  await expect(page.getByTestId('pause-hint')).toHaveText('Esc or P to resume');
  await page.keyboard.press('Enter');
  await expectMode(page, 'playing');

  // A pause on its own (the window lost focus) offers the same.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectMode(page, 'paused');
  await expect(resume(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await nextFrames(page, 3);
  expect(await shotsFired(page), 'the Space that resumed fired nothing').toBe(0);
});

test('Space held as the run pauses does not resume when let go, and leaves no fire held @desktop', async ({ page }) => {
  await openGame(page);
  await playByPointer(page, false);
  await page.keyboard.down('Space');
  await expect.poll(() => shotsFired(page)).toBeGreaterThan(0);

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
  const before = await shotsFired(page);
  await nextFrames(page, 30);
  expect(await shotsFired(page), 'no fire is held after the pause').toBe(before);
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
  await openModeSelect(page, isMobile ? 'tap' : 'click');

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

/** The ways back from a screen, each of which must land where the others do. */
const BACK_WAYS: readonly (readonly [name: string, goBack: (page: Page, isMobile: boolean) => Promise<void>])[] = [
  ['Esc', (page) => page.keyboard.press('Escape')],
  ['pad B', (page) => tapPad(page, PAD.B)],
  ['the Back button', (page, isMobile) => press(page.getByTestId('back'), isMobile)],
];

for (const [way, goBack] of BACK_WAYS) {
  test(`${way} goes back one screen from galaxy select, the map and mode select, focus on the button that left each`, async ({ page, isMobile }) => {
    await installFakePad(page);
    await openGame(page, { galaxy: null });
    await openModeSelect(page, isMobile ? 'tap' : 'click');
    await press(page.getByTestId('mode-free'), isMobile);
    await expectMode(page, 'map');
    await press(page.getByTestId('dimension-1'), isMobile);
    await expectMode(page, 'galaxySelect');

    await goBack(page, isMobile);
    await expectMode(page, 'map');
    await expect(page.getByTestId('dimension-1')).toBeFocused();
    await goBack(page, isMobile);
    await expectMode(page, 'modeSelect');
    await expect(page.getByTestId('mode-free')).toBeFocused();
    await goBack(page, isMobile);
    await expectMode(page, 'title');
    await expect(page.getByTestId('play')).toBeFocused();
  });
}

test('Esc and pad B on the title go nowhere', async ({ page }) => {
  await installFakePad(page);
  await openGame(page, { galaxy: null });
  await page.keyboard.press('Escape');
  await tapPad(page, PAD.B);
  await nextFrames(page, 3);
  await expectMode(page, 'title');
});

const COVER_CHIPS = [
  ['settings-open', 'Settings'],
  ['records-open', 'Records'],
  ['hangar-open', 'Hangar'],
] as const;

for (const [chipId, name] of COVER_CHIPS) {
  test(`over mode select, Esc closes the ${name} card alone, a held Esc closes nothing more, and pad B closes it too`, async ({ page, isMobile }) => {
    await installFakePad(page);
    await openGame(page, { galaxy: null });
    await openModeSelect(page, isMobile ? 'tap' : 'click');
    const chip = page.getByTestId(chipId);
    const dialog = page.getByRole('dialog', { name });

    await press(chip, isMobile);
    await expect(dialog).toBeVisible();
    // A second keydown of a held key is its auto-repeat: the card closes on the first, and the repeat leaves mode select be.
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    await page.keyboard.up('Escape');
    await expect(dialog).toBeHidden();
    await nextFrames(page, 3);
    await expectMode(page, 'modeSelect');
    await expect(chip).toBeFocused();

    await press(chip, isMobile);
    await expect(dialog).toBeVisible();
    await tapPad(page, PAD.B);
    await expect(dialog).toBeHidden();
    await nextFrames(page, 3);
    await expectMode(page, 'modeSelect');
    await expect(chip).toBeFocused();

    // With no card up, the next Esc goes back a screen.
    await page.keyboard.press('Escape');
    await expectMode(page, 'title');
  });
}

const titleHint = (page: Page, text: string) => page.locator('.overlay--title').getByText(text, { exact: true });

test('the hints follow the input used last: the screen only guesses until a key, a pad or a pointer is used', async ({ page, isMobile }) => {
  await installFakePad(page);
  await openGame(page);
  const keys = hintCopy('keys');
  const pad = hintCopy('pad');
  await expect(titleHint(page, hintCopy(isMobile ? 'touch' : 'keys').start)).toBeVisible();

  await tapPad(page, PAD.DPAD_DOWN);
  await expect(titleHint(page, pad.start)).toBeVisible();
  await expect(page.getByTestId('controls-hint')).toHaveText(pad.controls);

  await page.keyboard.press('ArrowDown');
  await expect(titleHint(page, keys.start)).toBeVisible();
  await expect(page.getByTestId('controls-hint')).toHaveText(keys.controls);

  // A tap names taps; a mouse sits beside a keyboard, so a click keeps the keys.
  await press(page.getByTestId('sound-toggle'), isMobile);
  await expect(titleHint(page, hintCopy(isMobile ? 'touch' : 'keys').start)).toBeVisible();
  await expect(page.getByTestId('controls-hint')).toBeVisible({ visible: !isMobile });

  // A pad player starts with A, and pad B in play pauses, as Esc does.
  await tapPad(page, PAD.A);
  await expectMode(page, 'playing');
  await expect(pauseButton(page)).toHaveAttribute('title', pad.pauseTip);
  await tapPad(page, PAD.B);
  await expectMode(page, 'paused');
  await expect(resume(page).locator('.key-hint')).toHaveText(pad.resumeKey);
  await expect(page.getByTestId('pause-hint')).toHaveText(pad.paused);
  await tapPad(page, PAD.B);
  await expectMode(page, 'playing');
});

/** How an end card is left, the input style that names it, and the mark the button it takes wears in that style. */
const END_WAYS: readonly (readonly [name: string, useStyle: (page: Page) => Promise<void>, leave: (page: Page, isMobile: boolean) => Promise<void>, mark: string])[] = [
  ['Esc', (page) => page.keyboard.press('Shift'), (page) => page.keyboard.press('Escape'), 'Esc'],
  ['pad B', (page) => tapPad(page, PAD.DPAD_DOWN), (page) => tapPad(page, PAD.B), 'B'],
  ['its Title button', (page) => page.keyboard.press('Shift'), (page, isMobile) => press(page.getByTestId('rank-title'), isMobile), 'Esc'],
];

for (const [way, useStyle, leave, mark] of END_WAYS) {
  test(`a Rank game over marks the button Back takes, says the run is kept, and ${way} leaves by it for the title`, async ({ page, isMobile }) => {
    await installFakePad(page);
    await openGameOverRun(page);
    await startRun(page, isMobile);
    await waitForGameOver(page);
    await waitOutGameOverGuard(page);
    const title = page.getByTestId('rank-title');
    const suspend = page.getByTestId('end-suspend');
    // A finger started the run on a phone: the card names no key.
    if (isMobile) {
      await expect(title.locator('.key-hint')).toBeHidden();
      await expect(suspend).toBeHidden();
    }

    await useStyle(page);
    await expect(title.locator('.key-hint')).toHaveText(mark);
    await expect(title).toHaveAccessibleName('Title');
    await expect(page.getByTestId('rank-continue').locator('.key-hint')).toHaveText(mark === 'B' ? 'A' : 'Enter');
    await expect(suspend).toHaveText(mark === 'B' ? hintCopy('pad').suspend : hintCopy('keys').suspend);

    await leave(page, isMobile);
    await expectMode(page, 'title');
    await expect(page.getByTestId('play')).toBeFocused();
  });
}

test('a Free play game over marks Map as where Esc goes, Retry as Enter\'s, and Esc lands on the map @desktop', async ({ page }) => {
  await openGame(page, { galaxy: GAME_OVER_GALAXY, seed: seedFor('free-game-over') });
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await fastForward(page, FREE_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await waitOutGameOverGuard(page);
  await expect(page.getByTestId('results-map').locator('.key-hint')).toHaveText('Esc');
  await expect(page.getByTestId('results-retry').locator('.key-hint')).toHaveText('Enter');
  await expect(page.getByTestId('end-suspend')).toBeHidden();

  await page.keyboard.press('Escape');
  await expectMode(page, 'map');
  await expect(page.getByTestId('dimension-1')).toBeFocused();
});

/** The boxes of `locators`, once every card has finished popping in. */
async function settledBoxes(page: Page, locators: readonly Locator[]): Promise<unknown[]> {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
  return Promise.all(locators.map((locator) => locator.boundingBox()));
}

/** Each input kind in turn, by a press no card acts on: Q, which no screen binds, and the D-pad, which only moves focus. */
const KIND_SWITCHES: readonly (readonly [kind: string, use: (page: Page) => Promise<void>])[] = [
  ['keys', (page) => page.keyboard.press('KeyQ')],
  ['pad', (page) => tapPad(page, PAD.DPAD_LEFT)],
  ['keys again', (page) => page.keyboard.press('KeyQ')],
];

/** The hints change words with the input kind, but `locators` (a card's buttons) stay exactly where and as large as they were. */
async function expectStillThroughKinds(page: Page, locators: readonly Locator[]): Promise<void> {
  const before = await settledBoxes(page, locators);
  for (const [kind, use] of KIND_SWITCHES) {
    await use(page);
    await nextFrames(page, 2);
    expect(await settledBoxes(page, locators), `after ${kind}`).toEqual(before);
  }
}

test('the title, pause and end cards keep their size and their buttons their places as the input kind changes', async ({ page, isMobile }) => {
  await installFakePad(page);
  await openGameOverRun(page);
  // A phone starts in touch, its guess; a desktop in keys.
  await expectStillThroughKinds(page, [page.getByTestId('play')]);

  await startRun(page, isMobile);
  await press(pauseButton(page), isMobile);
  await expectMode(page, 'paused');
  await expectStillThroughKinds(page, [resume(page), quit(page)]);

  await press(resume(page), isMobile);
  await expectMode(page, 'playing');
  await waitForGameOver(page);
  await expectStillThroughKinds(page, [page.getByTestId('rank-continue'), page.getByTestId('rank-title')]);
});
