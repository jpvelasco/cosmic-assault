import type { JSHandle, Page } from '@playwright/test';
import { PLAYER } from '../src/sim/config';
import { expect, expectMode, gameState, openGame, shipState, speed, test } from './fixtures';

/** Starts a run with Space, then releases it so the start-key latch lets Space fire again. */
async function startWithSpace(page: Page): Promise<void> {
  await openGame(page);
  expect((await gameState(page)).ship).toBeNull();
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
}

/** Resolves with how long, in page time, the next press of `code` was held. */
function recordHold(page: Page, code: string): Promise<JSHandle<{ seconds: Promise<number> }>> {
  return page.evaluateHandle((key) => {
    let downAt = 0;
    const seconds = new Promise<number>((resolve) => {
      window.addEventListener('keydown', (e) => {
        if (e.code === key && !e.repeat) downAt = e.timeStamp;
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === key) resolve((e.timeStamp - downAt) / 1000);
      });
    });
    return { seconds };
  }, code);
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test.beforeEach(async ({ page }) => {
  await startWithSpace(page);
});

test('holding ArrowLeft for 500 ms turns the ship anticlockwise at the turn rate', async ({ page }) => {
  const before = await shipState(page);
  const held = await recordHold(page, 'ArrowLeft');

  await hold(page, 'ArrowLeft', 500);

  const heldSeconds = await held.evaluate((h) => h.seconds);
  const turned = before.angle - (await shipState(page)).angle;
  // The sim samples keys once per frame and drops time from stalled frames (the loop caps each
  // frame), so on a loaded host the turn can drift from the wall-clock hold; 0.5 rad was exceeded
  // (0.56) once in 360 runs on 6 workers. The bridge has no sim clock, so allow ±1 rad.
  expect(Math.abs(turned - PLAYER.turnSpeed * heldSeconds)).toBeLessThan(1);
  expect(turned).toBeGreaterThan(1);
});

test('holding ArrowUp for 500 ms thrusts the ship above 50 px/s', async ({ page }) => {
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(500);
  const ship = await shipState(page);
  await page.keyboard.up('ArrowUp');

  expect(ship.thrusting).toBe(true);
  expect(speed(ship)).toBeGreaterThan(50);
});

test('holding Space fires at least 3 projectiles', async ({ page }) => {
  expect((await gameState(page)).projectileCount).toBe(0);

  await page.keyboard.down('Space');
  // Shots come every 0.32 s of sim time; a starved renderer advances the sim far slower than the
  // wall clock (2 s timed out at 2 shots twice in 160 runs on 6 workers), so allow 5 s.
  await expect
    .poll(async () => (await gameState(page)).projectileCount, { timeout: 5000 })
    .toBeGreaterThanOrEqual(3);
  await page.keyboard.up('Space');
});

test('Escape pauses and freezes the ship, and Escape again resumes', async ({ page }) => {
  await hold(page, 'ArrowUp', 300);
  expect(speed(await shipState(page))).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  const paused = await shipState(page);
  // Deliberate wait: the assertion is that nothing moves during it.
  await page.waitForTimeout(300);
  const later = await shipState(page);
  expect({ x: later.x, y: later.y }).toEqual({ x: paused.x, y: paused.y });

  await page.keyboard.press('Escape');
  await expectMode(page, 'playing');
  await expect.poll(async () => (await shipState(page)).y).not.toBe(paused.y);
});

test('losing focus pauses and forgets a held key', async ({ page }) => {
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await shipState(page)).thrusting).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect((await gameState(page)).mode).toBe('paused');

  // After a real blur the keyup lands in another window, so swallow it before the game sees it.
  await page.evaluate(() => {
    window.addEventListener(
      'keyup',
      (e) => {
        if (e.code === 'ArrowUp') e.stopImmediatePropagation();
      },
      { capture: true, once: true },
    );
  });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Escape');
  await expectMode(page, 'playing');

  await expect.poll(async () => (await shipState(page)).thrusting).toBe(false);
});

test('hiding the tab pauses the run', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expectMode(page, 'paused');
});

test('Quit on the pause menu returns to the title screen', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');

  await page.getByRole('button', { name: 'Quit' }).click();

  await expectMode(page, 'title');
  expect((await gameState(page)).ship).toBeNull();
  await expect(page.getByRole('heading', { name: 'Cosmic Assault' })).toBeVisible();
});

/** Signed turn over `ms` with `keys` held together, pressed in order like a player would, and how many shots flew. */
async function chord(page: Page, keys: readonly string[], ms: number): Promise<{ turned: number; thrusting: boolean; shots: number }> {
  for (const key of keys) await page.keyboard.down(key);
  const before = await shipState(page);
  await page.waitForTimeout(ms);
  const after = await shipState(page);
  const shots = (await gameState(page)).projectileCount;
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  return { turned: after.angle - before.angle, thrusting: after.thrusting, shots };
}

// A player reported the ship refusing to turn left while thrusting and firing. Some keyboards cannot report
// Up + Left + Space together (key ghosting), so the game also fires on Z and X; every chord must steer both ways.
for (const [thrust, fire, left, right] of [
  ['ArrowUp', 'Space', 'ArrowLeft', 'ArrowRight'],
  ['ArrowUp', 'KeyZ', 'ArrowLeft', 'ArrowRight'],
  ['ArrowUp', 'KeyX', 'ArrowLeft', 'ArrowRight'],
  ['KeyW', 'Space', 'KeyA', 'KeyD'],
  ['KeyW', 'ShiftLeft', 'KeyA', 'KeyD'],
] as const) {
  test(`thrusting with ${thrust} and firing with ${fire} still turns both ways`, async ({ page }) => {
    const leftTurn = await chord(page, [thrust, fire, left], 400);
    expect(leftTurn.thrusting).toBe(true);
    expect(leftTurn.shots).toBeGreaterThan(0);
    expect(leftTurn.turned).toBeLessThan(-0.8);

    const rightTurn = await chord(page, [thrust, fire, right], 400);
    expect(rightTurn.turned).toBeGreaterThan(0.8);
  });
}

test('the title names the fire keys that avoid key ghosting', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('controls-hint')).toHaveText('Fly with the arrows or WASD · fire with Space, Z or X');
});
