import type { Page } from '@playwright/test';
import { SAVE_KEY } from '../src/meta/save';
import {
  clickPastGuard,
  damageBoss,
  expect,
  expectMode,
  KILL_SHOTS,
  fastForward,
  gameState,
  openBossGame,
  openFreshGame,
  openGalaxySelect,
  pinClockSeed,
  playFreeGalaxy,
  seedStorage,
  storedSave,
  test,
  waitForBridge,
} from './fixtures';
import { STEP_SECONDS } from '../src/sim/config';
import { BOSS_GALAXY, CLEAR_1_1_SECONDS, seedFor, TO_BOSS_FIGHT_SECONDS } from './seeds';


test('Free play: 1-1 clears to a results card with its stars, saved as the warp starts, opens 1-2 on the map, and a reload keeps it', async ({ page }) => {
  await pinClockSeed(page, seedFor('clears-1-1'));
  await openFreshGame(page);
  await openGalaxySelect(page, 1);
  await expect(page.getByTestId('galaxy-1-1')).toBeEnabled();
  await expect(page.getByTestId('galaxy-1-2')).toBeDisabled();
  await page.getByTestId('galaxy-1-1').click();
  await expectMode(page, 'playing');

  await fastForward(page, CLEAR_1_1_SECONDS);
  const { screen, galaxy, save } = await gameState(page);
  expect({ screen, galaxy }).toEqual({ screen: 'results', galaxy: '1-1' });
  // Straight away, under the card: the stored save already holds the clear, so a reload now would keep it.
  expect(await storedSave(page)).toMatchObject({ frontier: '1-2', galaxies: { '1-1': save.galaxies['1-1'] } });
  const progress = save.galaxies['1-1'];
  expect(progress?.stars).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Galaxy cleared' })).toBeVisible();
  await expect(page.locator('.card--end .star--earned')).toHaveCount(progress?.stars ?? 0);
  await expect(page.getByText(`Score ${String(progress?.bestScore)}`)).toBeVisible();

  // Map: back through the card's Map button, no reload, and 1-2 is open.
  await clickPastGuard(page, 'results-map', 'map');
  await page.getByTestId('dimension-1').click();
  await expect(page.getByTestId('galaxy-1-2')).toBeEnabled();
  await expect(page.getByTestId('galaxy-1-1')).toContainText(`Best ${String(progress?.bestScore)}`);

  await page.reload();
  await waitForBridge(page);
  expect((await gameState(page)).save).toMatchObject({ frontier: '1-2', galaxies: { '1-1': progress } });
  await openGalaxySelect(page, 1);
  await expect(page.getByTestId('galaxy-1-2')).toBeEnabled();
});

test.describe(`boss galaxy ${BOSS_GALAXY}`, () => {
  test('a debug run beats the Monolith and shows the results card, and leaves the save alone', async ({ page }) => {
    await openBossGame(page);
    await page.keyboard.press('Space');
    await expectMode(page, 'playing');
    expect((await gameState(page)).save.frontier).toBe('1-1');

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    expect((await gameState(page)).screen).toBe('playing');
    await damageBoss(page, KILL_SHOTS);
    // The killing blow ends the galaxy on the next step: the boss dies under the results card.
    await fastForward(page, STEP_SECONDS);

    const { screen, galaxy, save } = await gameState(page);
    expect({ screen, galaxy }).toEqual({ screen: 'results', galaxy: BOSS_GALAXY });
    await expect(page.getByRole('heading', { name: 'Galaxy cleared' })).toBeVisible();
    // A debug run keeps its progress in memory (the card shows the clear) and never writes storage.
    expect(save.frontier).toBe('2-1');
    expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBeNull();
  });

  test('damaging a boss that is not fighting is refused, with what to do', async ({ page }) => {
    await openBossGame(page);
    await page.keyboard.press('Space');
    await expectMode(page, 'playing');

    const refused = await page.evaluate(() => {
      try {
        window.__COSMIC_ASSAULT_TEST_API__?.damageBoss(1);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(refused).toContain('No boss is fighting');
  });
});

test('a clear in one tab opens the next galaxy in another without a reload, and the other tab keeps it when it writes', async ({ page, context }) => {
  await pinClockSeed(page, seedFor('clears-1-1'));
  await openFreshGame(page);
  const other = await context.newPage();
  await openFreshGame(other);
  await openGalaxySelect(other, 1);
  await expect(other.getByTestId('galaxy-1-2')).toBeDisabled();

  await page.bringToFront();
  await playFreeGalaxy(page, '1-1');
  await fastForward(page, CLEAR_1_1_SECONDS);
  expect((await gameState(page)).save.frontier).toBe('1-2');

  // The other tab never reloaded: it heard the storage event.
  await expect(other.getByTestId('galaxy-1-2')).toBeEnabled();
  expect((await gameState(other)).save).toMatchObject({ frontier: '1-2', galaxies: { '1-1': (await gameState(page)).save.galaxies['1-1'] } });

  // Its own next write (a new Rank run) goes over the merged save, so the frontier and the clear stay.
  await other.bringToFront();
  await other.getByTestId('back').click();
  await other.getByTestId('back').click();
  await other.getByTestId('mode-rank').click();
  await expectMode(other, 'playing');
  const stored = await storedSave(other);
  expect(stored).toMatchObject({ frontier: '1-2', rankRun: { next: '1-1', inGalaxy: true } });
  expect(stored.galaxies?.['1-1']?.stars).toBeGreaterThan(0);
});

/** Stores `text` as the save before the first load of `page` (and only then, so a reload keeps what the game wrote), then opens the game. */
async function openWithStoredText(page: Page, text: string): Promise<void> {
  await seedStorage(page, text, { once: true });
  await openFreshGame(page);
}

test.describe('a save that cannot be read', () => {
  for (const [name, text] of [
    ['garbage text', 'not json {{{'],
    ['truncated JSON', '{"version":1,"frontier":"1-3","galaxies":{"1-1":{"bestSc'],
    ['an array', '[1,2,3]'],
    ['a record of the wrong types', '{"version":1,"frontier":"9-9","galaxies":{"1-1":"x"},"rankRun":{"lives":"many"},"rankBoard":5}'],
  ] as const) {
    test(`${name} loads the defaults, with no console errors, on the title and the map`, async ({ page }) => {
      await openWithStoredText(page, text);

      const { screen, save } = await gameState(page);
      expect(screen).toBe('title');
      expect(save).toMatchObject({ frontier: '1-1', galaxies: {}, rankRun: null, rankBoard: [] });
      await openGalaxySelect(page, 1);
      await expect(page.getByTestId('galaxy-1-1')).toBeEnabled();
      await expect(page.getByTestId('galaxy-1-2')).toBeDisabled();
    });
  }

  test('after one, the game still plays, and its next write replaces the unreadable text with a valid save', async ({ page }) => {
    await pinClockSeed(page, seedFor('clears-1-1'));
    await openWithStoredText(page, 'not json {{{');
    await playFreeGalaxy(page, '1-1');

    await fastForward(page, CLEAR_1_1_SECONDS);
    expect(await storedSave(page)).toMatchObject({ version: 1, frontier: '1-2' });
  });

  test('a field that fails keeps the fields that pass', async ({ page }) => {
    await openWithStoredText(page, '{"version":1,"frontier":"1-3","galaxies":{"1-1":{"bestScore":900,"stars":2}},"rankRun":{"lives":"many"},"rankBoard":"x"}');

    const { save } = await gameState(page);
    expect(save).toMatchObject({ frontier: '1-3', rankRun: null, rankBoard: [], galaxies: { '1-1': { bestScore: 900, stars: 2 } } });
    await openGalaxySelect(page, 1);
    await expect(page.getByTestId('galaxy-1-3')).toBeEnabled();
    await expect(page.getByTestId('galaxy-1-4')).toBeDisabled();
  });
});
