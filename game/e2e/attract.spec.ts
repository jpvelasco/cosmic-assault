import type { Page } from '@playwright/test';
import { ATTRACT_IDLE_SECONDS } from '../src/app/attract';
import { ATTRACT_IDLE_TIMEOUT_MS, askForAttract, attractState, expect, expectDemoEndedOnTitle, expectMode, gameState, nextFrames, openGame, startAttract, test } from './fixtures';

/** The demo the cycle plays first. */
const FIRST_DEMO = '1-3';

/** Every key `localStorage` holds, with its value. */
const storageOf = (page: Page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));

/** The phone size the owner checks layouts at, on its side. */
const PHONE_VIEWPORT = { width: 844, height: 390 };

/** How much earlier than ATTRACT_IDLE_SECONDS after the page is ready the demo may start: the idle count starts as the app does, a little before. */
const IDLE_START_SLACK_MS = 2000;

/** Real seconds a reduced-motion title is watched for a demo: well past the idle stretch. */
const REDUCED_MOTION_WATCH_MS = 14_000;

declare global {
  interface Window {
    /** Every audio connection the page has made, source and destination, in order (see `recordAudioConnections`). */
    __caAudioEdges?: [AudioNode, AudioNode][];
  }
}

/**
 * Records every audio connection the page makes, from before it loads. The engine's graph (src/audio/engine.ts) is
 * sound effects → master gain → compressor, with the music joining the master through its lowpass, so the master is
 * the gain feeding a compressor and the effects bus the one other gain feeding the master.
 */
async function recordAudioConnections(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const edges: [AudioNode, AudioNode][] = [];
    window.__caAudioEdges = edges;
    const connect = Reflect.get(AudioNode.prototype, 'connect') as (this: AudioNode, ...args: unknown[]) => unknown;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const [destination] = args;
      if (destination instanceof AudioNode) edges.push([this, destination]);
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  });
}

/** How many connections into the sound-effects bus the page has made: one or more for every effect played. */
function sfxConnections(page: Page): Promise<number> {
  return page.evaluate(() => {
    const edges = window.__caAudioEdges ?? [];
    const master = edges.find(([, to]) => to instanceof DynamicsCompressorNode)?.[0];
    const bus = edges.find(([from, to]) => to === master && from instanceof GainNode)?.[0];
    if (master === undefined || bus === undefined) throw new Error('No sound-effects bus was wired: unlock sound with a key press first');
    return edges.filter(([, to]) => to === bus).length;
  });
}

/** Makes the page report itself hidden or visible, and tells it, as a tab sent to the background and back would. */
function setPageHidden(page: Page, hidden: boolean): Promise<void> {
  return page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

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

test('after 10 s on the title without input, the demo starts by itself and plays on', async ({ page }) => {
  test.setTimeout(ATTRACT_IDLE_TIMEOUT_MS + 15_000);
  await openGame(page);
  const ready = Date.now();
  expect(await attractState(page)).toMatchObject({ active: false, frames: 0 });
  await expect.poll(async () => (await attractState(page)).active, { timeout: ATTRACT_IDLE_TIMEOUT_MS }).toBe(true);
  expect(Date.now() - ready, 'the demo waits out the idle stretch').toBeGreaterThanOrEqual(ATTRACT_IDLE_SECONDS * 1000 - IDLE_START_SLACK_MS);
  const { frames } = await attractState(page);
  await expect.poll(async () => (await attractState(page)).frames).toBeGreaterThan(frames);
});

test('the demo plays no sound effect, which play then does', { tag: '@desktop' }, async ({ page }) => {
  await recordAudioConnections(page);
  await openGame(page);
  // Two presses of M unlock sound without leaving the title, and leave it on.
  await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyM');
  await expect.poll(async () => (await gameState(page)).audioState).toBe('running');
  await expect.poll(async () => (await gameState(page)).muted).toBe(false);
  const before = await sfxConnections(page);

  await startAttract(page);
  // The expert fires from its first second; long enough for its shots and hits to have sounded, were they routed to audio.
  await expect.poll(async () => (await attractState(page)).frames).toBeGreaterThan(120);
  expect(await sfxConnections(page), 'no effect sounds during the demo').toBe(before);

  await page.keyboard.press('KeyM');
  await expectDemoEndedOnTitle(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.down('Space');
  await expect.poll(() => sfxConnections(page), { message: 'play fires and sounds its shots' }).toBeGreaterThan(before);
  await page.keyboard.up('Space');
});

test('never plays under reduced motion, however long the title waits', async ({ page }) => {
  test.setTimeout(REDUCED_MOTION_WATCH_MS + 30_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  // Deliberate wait: the assertion is that nothing starts during it.
  await page.waitForTimeout(REDUCED_MOTION_WATCH_MS);
  expect(await attractState(page)).toMatchObject({ active: false, frames: 0 });
  // Not even with the idle stretch counted as over.
  await askForAttract(page);
  await nextFrames(page, 10);
  expect(await attractState(page)).toMatchObject({ active: false, frames: 0 });
});

test('never plays with the Hangar over the title', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('hangar-open').click();
  await expect(page.getByTestId('hangar')).toBeVisible();
  await askForAttract(page);
  await nextFrames(page, 10);
  expect((await attractState(page)).active).toBe(false);
});

test('stops when the tab is hidden, never starts while it is, and plays again once it is back', async ({ page }) => {
  await openGame(page);
  await startAttract(page);
  await setPageHidden(page, true);
  await expect.poll(async () => (await attractState(page)).active).toBe(false);
  expect((await gameState(page)).screen).toBe('title');
  await askForAttract(page);
  await nextFrames(page, 10);
  expect((await attractState(page)).active, 'no demo while hidden').toBe(false);

  await setPageHidden(page, false);
  await startAttract(page);
});
