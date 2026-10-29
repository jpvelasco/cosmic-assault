import type { JSHandle, Page } from '@playwright/test';
import { PLAYER } from '../src/sim/config';
import { expect, expectMode, gameState, grantPickup, nextFrames, openGame, setPageHidden, shipState, shotsFired, shotsPerVolley, speed, test } from './fixtures';

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
  await setPageHidden(page, true);

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

/** The shots one trigger fires while `keys` are held, counted through the bridge's shot events. */
async function volleyHolding(page: Page, keys: readonly string[]): Promise<number> {
  for (const key of keys) await page.keyboard.down(key);
  // A frame drains the fresh presses, which lets go of a start key still latched; the fast-forward reads controls but drains none.
  await nextFrames(page, 2);
  const shots = await shotsPerVolley(page);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  return shots;
}

test('with the Wingman beside it, a thrust, fire and turn chord still turns both ways and each trigger fires one more shot', async ({ page }) => {
  const held = ['ArrowUp', 'Space', 'ArrowLeft'] as const;
  const alone = await volleyHolding(page, held);
  await grantPickup(page, 'wingman');
  await expect.poll(async () => (await gameState(page)).effects.wingman ?? 0).toBeGreaterThan(0);
  expect(await volleyHolding(page, held)).toBeGreaterThan(alone);
  expect(await volleyHolding(page, ['ArrowUp', 'KeyZ', 'ArrowRight'])).toBeGreaterThan(alone);

  const leftTurn = await chord(page, held, 400);
  expect(leftTurn.thrusting).toBe(true);
  expect(leftTurn.turned).toBeLessThan(-0.8);
  const rightTurn = await chord(page, ['ArrowUp', 'KeyZ', 'ArrowRight'], 400);
  expect(rightTurn.turned).toBeGreaterThan(0.8);
});

/** Puts the mouse on the bare field, a quarter of the way across and clear of the pause button. */
async function pointAtField(page: Page): Promise<void> {
  const box = await page.locator('#game').boundingBox();
  if (box === null) throw new Error('The game canvas has no layout box; start a run first');
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
}

/** `chord` with the mouse button held on the field as well, pressed first; `shots` counts those fired while it was held. */
async function mouseChord(page: Page, keys: readonly string[], ms: number): Promise<{ turned: number; thrusting: boolean; shots: number }> {
  await pointAtField(page);
  const before = await shotsFired(page);
  await page.mouse.down();
  const held = await chord(page, keys, ms);
  await page.mouse.up();
  return { ...held, shots: (await shotsFired(page)) - before };
}

// The mouse button is the other way round key ghosting: held on the field, it fires through every thrust and turn chord.
for (const [thrust, left, right] of [
  ['ArrowUp', 'ArrowLeft', 'ArrowRight'],
  ['KeyW', 'KeyA', 'KeyD'],
] as const) {
  test(`thrusting with ${thrust} and firing with the mouse button still turns both ways`, async ({ page }) => {
    const leftTurn = await mouseChord(page, [thrust, left], 400);
    expect(leftTurn.thrusting).toBe(true);
    expect(leftTurn.shots).toBeGreaterThan(0);
    expect(leftTurn.turned).toBeLessThan(-0.8);

    const rightTurn = await mouseChord(page, [thrust, right], 400);
    expect(rightTurn.shots).toBeGreaterThan(0);
    expect(rightTurn.turned).toBeGreaterThan(0.8);
  });

  test(`the mouse button fires beside ${thrust} alone, and beside ${left} or ${right} alone`, async ({ page }) => {
    const thrusting = await mouseChord(page, [thrust], 400);
    expect(thrusting.thrusting).toBe(true);
    expect(thrusting.shots).toBeGreaterThan(0);

    const leftTurn = await mouseChord(page, [left], 400);
    expect(leftTurn.thrusting).toBe(false);
    expect(leftTurn.shots).toBeGreaterThan(0);
    expect(leftTurn.turned).toBeLessThan(-0.8);

    const rightTurn = await mouseChord(page, [right], 400);
    expect(rightTurn.shots).toBeGreaterThan(0);
    expect(rightTurn.turned).toBeGreaterThan(0.8);
  });
}

test('letting go of the mouse button stops fire while the keys still thrust and turn', async ({ page }) => {
  await pointAtField(page);
  await page.mouse.down();
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowLeft');
  await expect.poll(() => shotsFired(page)).toBeGreaterThan(0);

  await page.mouse.up();
  await nextFrames(page, 2);
  const before = await shipState(page);
  const shots = await shotsFired(page);
  // Deliberate wait: longer than the fire interval, so a fire still held would shoot in it.
  await page.waitForTimeout(500);
  const after = await shipState(page);
  expect(await shotsFired(page), 'no shot once the button is let go').toBe(shots);
  expect(after.thrusting).toBe(true);
  expect(after.angle - before.angle).toBeLessThan(-0.8);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
});

test('a click on the Pause button pauses without a shot, after the mouse button has fired', async ({ page }) => {
  expect((await mouseChord(page, [], 400)).shots).toBeGreaterThan(0);
  const shots = await shotsFired(page);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expectMode(page, 'paused');
  await page.keyboard.press('Escape');
  await expectMode(page, 'playing');
  await nextFrames(page, 30);
  expect(await shotsFired(page), 'the click on Pause fired nothing, then or after').toBe(shots);
});

for (const [cause, pauseRun] of [
  ['Escape', (page: Page) => page.keyboard.press('Escape')],
  ['a lost focus', (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('blur')))],
  ['a hidden tab', (page: Page) => setPageHidden(page, true)],
] as const) {
  test(`the mouse button held through a pause by ${cause} fires no more once the run resumes`, async ({ page }) => {
    await pointAtField(page);
    await page.mouse.down();
    await expect.poll(() => shotsFired(page)).toBeGreaterThan(0);

    await pauseRun(page);
    await expectMode(page, 'paused');
    // The hidden tab shows again; the other pauses never hid it.
    await setPageHidden(page, false);
    await page.keyboard.press('Escape');
    await expectMode(page, 'playing');
    await nextFrames(page, 3);
    const shots = await shotsFired(page);
    await nextFrames(page, 30);
    expect(await shotsFired(page), 'no fire is held after the pause').toBe(shots);
    await page.mouse.up();
  });
}

test('the title names the fire keys and the mouse button that avoid key ghosting', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('controls-hint')).toHaveText('Fly with the arrows or WASD · fire with Space, Z, X or the mouse button');
});
