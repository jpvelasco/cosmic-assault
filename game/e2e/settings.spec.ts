import type { Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/app/settings';
import { expect, expectMode, gameState, nextFrames, openGame, test } from './fixtures';

const openChip = (page: Page) => page.getByTestId('settings-open');
const card = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const music = (page: Page) => page.getByTestId('settings-music');
const effects = (page: Page) => page.getByTestId('settings-sfx');
const shakeChoice = (page: Page, name: 'Auto' | 'On' | 'Off') => card(page).getByRole('radio', { name });
const leftHanded = (page: Page) => page.getByRole('checkbox', { name: 'Left-handed controls' });
const done = (page: Page) => card(page).getByRole('button', { name: 'Done' });
const settingsOf = async (page: Page) => (await gameState(page)).settings;
const storedSettings = (page: Page) => page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);

test('opens from the title without starting a run, and Done returns to it with focus on the chip', async ({ page, isMobile }) => {
  await openGame(page);
  await expect(card(page)).toBeHidden();

  await openChip(page).click();
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await nextFrames(page, 3);
  await expectMode(page, 'title');
  // Every control has a visible label.
  for (const label of ['Music volume', 'Effects volume', 'Screen shake']) {
    await expect(card(page).getByText(label, { exact: true })).toBeVisible();
  }
  // Left-handed controls only mean something on a touch screen.
  await expect(leftHanded(page)).toBeVisible({ visible: isMobile });

  await done(page).click();
  await expect(card(page)).toBeHidden();
  await expectMode(page, 'title');
  await expect(openChip(page)).toBeFocused();
});

test('Esc closes the card from a focused slider, and a pause stays a pause', async ({ page }) => {
  await openGame(page);
  await openChip(page).click();
  await expect(music(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(openChip(page)).toBeFocused();
  await expectMode(page, 'title');

  await page.keyboard.press('Enter');
  await expect(card(page)).toBeVisible();
  await expectMode(page, 'title');
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();

  await page.keyboard.press('Space');
  await expect(card(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expectMode(page, 'title');
});

test('opened from pause it keeps the game paused until Esc is pressed on the pause card', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');

  await openChip(page).click();
  await expect(card(page)).toBeVisible();
  await nextFrames(page, 3);
  await expectMode(page, 'paused');

  // One Esc closes the card and nothing more.
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await nextFrames(page, 3);
  await expectMode(page, 'paused');
  await expect(openChip(page)).toBeFocused();

  await openChip(page).click();
  await done(page).click();
  await nextFrames(page, 3);
  await expectMode(page, 'paused');

  await page.keyboard.press('Escape');
  await expectMode(page, 'playing');
});

test('Space and Enter with focus off every control do not start a run behind the card', async ({ page }) => {
  await openGame(page);
  await openChip(page).click();
  await card(page).getByRole('heading', { name: 'Settings' }).click();
  await expect(music(page)).not.toBeFocused();

  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await nextFrames(page, 3);
  await expectMode(page, 'title');
  await expect(card(page)).toBeVisible();
});

test('Enter and Space on Done close the card without starting a run', async ({ page }) => {
  await openGame(page);
  await openChip(page).click();
  await done(page).focus();
  await page.keyboard.press('Space');
  await expect(card(page)).toBeHidden();
  await nextFrames(page, 3);
  await expectMode(page, 'title');
});

test('arrow keys move a focused slider and the game ignores them; M and F do nothing there', async ({ page }) => {
  await openGame(page);
  await openChip(page).click();
  await expect(music(page)).toHaveValue('60');

  await page.keyboard.press('ArrowRight');
  await expect(music(page)).toHaveValue('65');
  await expect.poll(async () => (await settingsOf(page)).musicVolume).toBe(0.65);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(music(page)).toHaveValue('55');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyF');
  await nextFrames(page, 3);
  expect((await gameState(page)).muted).toBe(false);
  expect((await gameState(page)).fullscreen).toBe(false);
  await expectMode(page, 'title');
});

test('volume, shake and the sound chip apply live and persist across a reload', async ({ page }) => {
  await openGame(page);
  await openChip(page).click();
  await music(page).fill('20');
  await effects(page).fill('45');
  await shakeChoice(page, 'Off').check();
  await expect.poll(() => settingsOf(page)).toMatchObject({ musicVolume: 0.2, sfxVolume: 0.45, screenShake: 'off' });
  await card(page).getByTestId('settings-sound').click();
  await expect(card(page).getByTestId('settings-sound')).toHaveText('Sound: off');
  await expect.poll(async () => (await gameState(page)).muted).toBe(true);
  expect(JSON.parse((await storedSettings(page)) ?? 'null')).toEqual({
    muted: true,
    musicVolume: 0.2,
    sfxVolume: 0.45,
    screenShake: 'off',
    leftHanded: false,
  });
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([SETTINGS_KEY]);

  await openGame(page);
  expect(await settingsOf(page)).toEqual({ muted: true, musicVolume: 0.2, sfxVolume: 0.45, screenShake: 'off', leftHanded: false });
  await expect(page.getByTestId('sound-toggle')).toHaveText('Sound: off');
  await openChip(page).click();
  await expect(music(page)).toHaveValue('20');
  await expect(effects(page)).toHaveValue('45');
  await expect(shakeChoice(page, 'Off')).toBeChecked();
  await expect(card(page).getByTestId('settings-sound')).toHaveText('Sound: off');
});

test('saves when a control is let go, not on every move', async ({ page }) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.assign(window, { __writes: writes });
    const original: unknown = Reflect.get(Storage.prototype, 'setItem');
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(value);
      Reflect.apply(original as Storage['setItem'], this, [key, value]);
    };
  });
  await openGame(page);
  await openChip(page).click();
  const writes = () => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes.length);

  await music(page).evaluate((el: HTMLInputElement) => {
    for (const value of ['10', '15', '20']) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await expect.poll(async () => (await settingsOf(page)).musicVolume).toBe(0.2);
  expect(await writes()).toBe(0);

  await music(page).dispatchEvent('change');
  expect(await writes()).toBe(1);
});

test('the effects slider plays the click sample when let go, not while dragged', async ({ page }) => {
  await page.addInitScript(() => {
    // The click is the only sine sweep that ends on exactly 880 Hz; each one is a ramp to that value.
    const clicks: number[] = [];
    Object.assign(window, { __clicks: clicks });
    const original: unknown = Reflect.get(AudioParam.prototype, 'exponentialRampToValueAtTime');
    AudioParam.prototype.exponentialRampToValueAtTime = function (value: number, endTime: number) {
      if (value === 880) clicks.push(endTime);
      return Reflect.apply(original as AudioParam['exponentialRampToValueAtTime'], this, [value, endTime]);
    };
  });
  await openGame(page);
  // A pointer press unlocks audio; the chip's click does not start a run.
  await openChip(page).click();
  await expect.poll(async () => (await gameState(page)).audioState).toBe('running');
  const clicks = () => page.evaluate(() => (window as unknown as { __clicks: number[] }).__clicks.length);
  const before = await clicks();

  await effects(page).evaluate((el: HTMLInputElement) => {
    for (const value of ['10', '15', '20']) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await nextFrames(page, 2);
  expect(await clicks()).toBe(before);

  await effects(page).dispatchEvent('change');
  await expect.poll(clicks).toBe(before + 1);
  await music(page).dispatchEvent('change');
  await nextFrames(page, 2);
  expect(await clicks()).toBe(before + 1);
});

test('left-handed is remembered and the checkbox follows it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The choice is offered on touch screens only');
  await openGame(page);
  await openChip(page).click();
  await expect(leftHanded(page)).not.toBeChecked();
  await leftHanded(page).check();
  await expect.poll(async () => (await settingsOf(page)).leftHanded).toBe(true);

  await openGame(page);
  await openChip(page).click();
  await expect(leftHanded(page)).toBeChecked();
});

test('the card fits the screen, Done included', async ({ page }) => {
  await openGame(page);
  await openChip(page).click();
  await expect(card(page)).toBeInViewport({ ratio: 1 });
  await expect(done(page)).toBeInViewport({ ratio: 1 });
});

test('left-handed swaps the joystick and FIRE, keeps pause top right, and survives a reload', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Only the touch project shows the touch layer');
  await openGame(page);
  const boxes = async () => {
    const [stick, fire, pause] = await Promise.all(
      ['touch-joystick', 'touch-fire', 'touch-pause'].map(async (id) => {
        const box = await page.getByTestId(id).boundingBox();
        if (box === null) throw new Error(`${id} has no layout box; is the touch layer shown?`);
        return box;
      }),
    );
    return { stick: stick as NonNullable<typeof stick>, fire: fire as NonNullable<typeof fire>, pause: pause as NonNullable<typeof pause> };
  };
  const width = page.viewportSize()?.width ?? 0;

  await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
  await expectMode(page, 'playing');
  const before = await boxes();
  expect(before.stick.x).toBeLessThan(before.fire.x);

  await page.getByTestId('touch-pause').tap();
  await expectMode(page, 'paused');
  await openChip(page).tap();
  await leftHanded(page).check();
  await done(page).tap();
  await page.getByRole('button', { name: 'Resume' }).tap();
  await expectMode(page, 'playing');

  const after = await boxes();
  expect(after.stick.x).toBeGreaterThan(after.fire.x);
  // Each mirrors the other side's gap to the edge.
  expect(after.stick.x + after.stick.width).toBeCloseTo(width - before.stick.x, 0);
  expect(after.fire.x).toBeCloseTo(width - (before.fire.x + before.fire.width), 0);
  expect(after.pause).toEqual(before.pause);

  await openGame(page);
  await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
  await expectMode(page, 'playing');
  const reloaded = await boxes();
  expect(reloaded.stick.x).toBeGreaterThan(reloaded.fire.x);
});

for (const [name, init] of [
  [
    'storage that refuses every access',
    () => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Access is denied for this document.', 'SecurityError');
        },
      });
    },
  ],
  [
    'storage that refuses every write',
    () => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    },
  ],
] as const) {
  test(`with ${name} the card still changes the settings for the session, with no console error`, async ({ page }) => {
    await page.addInitScript(init);
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await openGame(page);
    await openChip(page).click();

    await music(page).fill('20');
    await shakeChoice(page, 'Off').check();
    await effects(page).fill('45');
    await expect.poll(() => settingsOf(page)).toMatchObject({ musicVolume: 0.2, sfxVolume: 0.45, screenShake: 'off' });
    await expect(music(page)).toHaveValue('20');
    await expect(shakeChoice(page, 'Off')).toBeChecked();

    await done(page).click();
    await openChip(page).click();
    await expect(music(page)).toHaveValue('20');
    await expect(effects(page)).toHaveValue('45');
    expect(warnings.some((text) => text.includes('Could not save your settings'))).toBe(true);
  });
}
