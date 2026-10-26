import type { CDPSession, Locator, Page } from '@playwright/test';
import {
  expect,
  expectMode,
  gameState,
  nextFrames,
  openGame,
  openGameOverRun,
  shipState,
  test,
  waitForGameOver,
  waitOutGameOverGuard,
} from './fixtures';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface TouchPoint extends Point {
  readonly id: number;
}

const STICK_FINGER = 1;
const FIRE_FINGER = 2;
const PAUSE_FINGER = 3;
const DRAG_PX = 50;

async function centreOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Touch control has no layout box; is the touch layer shown?');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Real multi-touch through CDP: each call sends every finger currently down, and
 * Chromium turns the differences into per-finger pointer events with their own
 * pointerIds and implicit capture, as on a phone. Synthetic `dispatchEvent`
 * pointers would make the adapter's `setPointerCapture` throw.
 */
function touchscreen(cdp: CDPSession) {
  let down: readonly TouchPoint[] = [];
  const send = async (type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly TouchPoint[]): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...points] });
    down = points;
  };
  return {
    press: (finger: TouchPoint) => send('touchStart', [...down.filter((p) => p.id !== finger.id), finger]),
    move: (finger: TouchPoint) => send('touchMove', down.map((p) => (p.id === finger.id ? finger : p))),
    releaseAll: () => send('touchEnd', []),
  };
}

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch needs Chromium');

async function tapToStart(page: Page, open: (page: Page) => Promise<void> = openGame): Promise<void> {
  await open(page);
  await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
  await expectMode(page, 'playing');
}

test('touch layer shows for a coarse pointer once a run starts', async ({ page }) => {
  await openGame(page);
  expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
  await expect(page.getByTestId('touch-joystick')).toBeHidden();

  await tapToStart(page);

  await expect(page.getByTestId('touch-joystick')).toBeVisible();
  await expect(page.getByTestId('touch-fire')).toBeVisible();
  await expect(page.getByTestId('touch-pause')).toBeVisible();
});

test('the stick steers and thrusts while a second finger holds FIRE', async ({ page }) => {
  await tapToStart(page);
  const fingers = touchscreen(await page.context().newCDPSession(page));
  const stick = await centreOf(page.getByTestId('touch-joystick'));
  const fire = await centreOf(page.getByTestId('touch-fire'));
  const start = await shipState(page);

  await fingers.press({ id: STICK_FINGER, ...stick });
  await fingers.move({ id: STICK_FINGER, x: stick.x + DRAG_PX, y: stick.y });

  await expect.poll(async () => (await shipState(page)).angle).toBeCloseTo(0, 1);
  await expect.poll(async () => (await shipState(page)).x).toBeGreaterThan(start.x + 5);
  expect((await gameState(page)).projectileCount).toBe(0);

  await fingers.press({ id: FIRE_FINGER, ...fire });
  await expect.poll(async () => (await gameState(page)).projectileCount).toBeGreaterThanOrEqual(2);

  // Still holding FIRE, the first finger keeps steering: point the stick straight down.
  await fingers.move({ id: STICK_FINGER, x: stick.x, y: stick.y + DRAG_PX });
  await expect.poll(async () => (await shipState(page)).angle).toBeCloseTo(Math.PI / 2, 1);
  expect((await shipState(page)).thrusting).toBe(true);

  await fingers.releaseAll();
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(false);
});

test('the pause button pauses, and Quit returns to the title screen', async ({ page }) => {
  await tapToStart(page);

  await page.getByTestId('touch-pause').tap();
  await expectMode(page, 'paused');
  await expect(page.getByTestId('touch-joystick')).toBeHidden();

  await page.getByRole('button', { name: 'Quit' }).tap();

  await expectMode(page, 'title');
  expect((await gameState(page)).ship).toBeNull();
});

test('a second finger on the pause button pauses while the thumb holds the stick', async ({ page }) => {
  await tapToStart(page);
  const fingers = touchscreen(await page.context().newCDPSession(page));
  const stick = await centreOf(page.getByTestId('touch-joystick'));
  const pause = await centreOf(page.getByTestId('touch-pause'));

  await fingers.press({ id: STICK_FINGER, ...stick });
  await fingers.move({ id: STICK_FINGER, x: stick.x + DRAG_PX, y: stick.y });
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(true);
  await fingers.press({ id: PAUSE_FINGER, ...pause });

  await expectMode(page, 'paused');
  await fingers.releaseAll();
});

test('taps on the game-over card outside its buttons keep the score; Continue plays on', async ({ page }) => {
  await tapToStart(page, openGameOverRun);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);

  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('The mobile project has no viewport; set one in playwright.config.ts');
  for (const tap of [() => page.touchscreen.tap(40, viewport.height / 2), () => page.getByText(/^Score \d+$/).tap()]) {
    await tap();
    await nextFrames(page, 3);
    expect((await gameState(page)).mode).toBe('gameOver');
  }

  await page.getByTestId('rank-continue').tap();
  await expectMode(page, 'playing');
});

test('a tap on the sound chip mutes without resuming the run or starting one', async ({ page }) => {
  await tapToStart(page);
  await page.getByTestId('touch-pause').tap();
  await expectMode(page, 'paused');
  const chip = page.getByTestId('sound-toggle');

  await chip.tap();
  await expect.poll(async () => (await gameState(page)).muted).toBe(true);
  await expect(chip).toHaveText('Sound: off');
  await nextFrames(page, 3);
  expect((await gameState(page)).mode).toBe('paused');

  await page.getByRole('button', { name: 'Quit' }).tap();
  await expectMode(page, 'title');
  await chip.tap();
  await expect.poll(async () => (await gameState(page)).muted).toBe(false);
  await expect(chip).toHaveText('Sound: on');
  await nextFrames(page, 3);
  expect((await gameState(page)).mode).toBe('title');
});
