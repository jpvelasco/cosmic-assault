import type { Page } from '@playwright/test';
import { defaultSave, SAVE_KEY, type SaveData } from '../src/meta/save';
import {
  clickPastGuard,
  expect,
  expectMode,
  fastForward,
  gameState,
  openFreshGame,
  openGalaxySelect,
  openGame,
  pinClockSeed,
  playFreeGalaxy,
  seedSave,
  storedSave,
  test,
  waitForBridge,
} from './fixtures';
import { STEP_SECONDS } from '../src/sim/config';
import { BOSS_GALAXY, CLEAR_1_1_SECONDS, E2E_SEED, SURVIVES_1_1, TO_BOSS_FIGHT_SECONDS } from './seed';

/** More than any boss' hit points. */
const KILL_DAMAGE = 100;

test('a clear is saved as the warp starts, so a reload straight after keeps it', async ({ page }) => {
  // No debug switch, so the run writes the real save; the pinned clock gives it a known seed.
  await pinClockSeed(page, SURVIVES_1_1);
  await openFreshGame(page);
  await playFreeGalaxy(page, '1-1');

  await fastForward(page, CLEAR_1_1_SECONDS);
  expect((await gameState(page)).screen).toBe('results');
  expect(await storedSave(page)).toMatchObject({ frontier: '1-2' });
  // Straight away: the save already holds the clear.
  await page.reload();
  await waitForBridge(page);

  const { save, screen } = await gameState(page);
  expect(screen).toBe('title');
  expect(save.frontier).toBe('1-2');
  expect(save.galaxies['1-1']?.stars).toBeGreaterThan(0);
  await openGalaxySelect(page, 1);
  await expect(page.getByTestId('galaxy-1-2')).toBeEnabled();
});

test('Free play: 1-1 clears to a results card with its stars, opens 1-2 on the map, and a reload keeps it', async ({ page }) => {
  await pinClockSeed(page, SURVIVES_1_1);
  await openFreshGame(page);
  await openGalaxySelect(page, 1);
  await expect(page.getByTestId('galaxy-1-1')).toBeEnabled();
  await expect(page.getByTestId('galaxy-1-2')).toBeDisabled();
  await page.getByTestId('galaxy-1-1').click();
  await expectMode(page, 'playing');

  await fastForward(page, CLEAR_1_1_SECONDS);
  const { screen, galaxy, save } = await gameState(page);
  expect({ screen, galaxy }).toEqual({ screen: 'results', galaxy: '1-1' });
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
  test('a debug run beats the Sentinel and shows the results card, and leaves the save alone', async ({ page }) => {
    await openGame(page, { galaxy: BOSS_GALAXY });
    await page.keyboard.press('Space');
    await expectMode(page, 'playing');
    expect((await gameState(page)).save.frontier).toBe('1-1');

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    expect((await gameState(page)).screen).toBe('playing');
    await page.evaluate((n) => window.__COSMIC_ASSAULT_TEST_API__?.damageBoss(n), KILL_DAMAGE);
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
    await openGame(page, { galaxy: BOSS_GALAXY });
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

  test('the normal flow records the boss clear and opens Dimension 2', async ({ page }) => {
    const save: SaveData = { ...defaultSave(), frontier: BOSS_GALAXY };
    await seedSave(page, save);
    await pinClockSeed(page, E2E_SEED);
    await openFreshGame(page);
    await page.getByTestId('play').click();
    await page.getByTestId('mode-free').click();
    await expect(page.getByTestId('dimension-2')).toBeDisabled();
    await page.getByTestId('dimension-1').click();
    await page.getByTestId(`galaxy-${BOSS_GALAXY}`).click();
    await expectMode(page, 'playing');

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    await page.evaluate((n) => window.__COSMIC_ASSAULT_TEST_API__?.damageBoss(n), KILL_DAMAGE);
    // The killing blow ends the galaxy on the next step: the boss dies under the results card.
    await fastForward(page, STEP_SECONDS);

    expect((await gameState(page)).screen).toBe('results');
    const stored = await storedSave(page);
    expect(stored.frontier).toBe('2-1');
    expect(stored.galaxies?.[BOSS_GALAXY]?.stars).toBeGreaterThan(0);
    await clickPastGuard(page, 'results-map', 'map');
    await expect(page.getByTestId('dimension-2')).toBeEnabled();
    await page.getByTestId('dimension-2').click();
    await expect(page.getByTestId('galaxy-2-1')).toBeEnabled();
  });
});

test('a clear in one tab opens the next galaxy in another without a reload, and the other tab keeps it when it writes', async ({ page, context }) => {
  await pinClockSeed(page, SURVIVES_1_1);
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
  await page.addInitScript(([key, value]) => {
    if (sessionStorage.getItem('seeded') !== null) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(key, value);
  }, [SAVE_KEY, text] as const);
  await openFreshGame(page);
}

test.describe('a save that cannot be read', () => {
  for (const [name, text] of [
    ['garbage text', 'not json {{{'],
    ['an array', '[1,2,3]'],
    ['a record of the wrong types', '{"version":1,"frontier":"9-9","galaxies":{"1-1":"x"},"rankRun":{"lives":"many"},"rankBoard":5}'],
  ] as const) {
    test(`${name} loads the defaults, with no console errors, and the game still plays and saves`, async ({ page }) => {
      await pinClockSeed(page, SURVIVES_1_1);
      await openWithStoredText(page, text);

      const { screen, save } = await gameState(page);
      expect(screen).toBe('title');
      expect(save).toMatchObject({ frontier: '1-1', galaxies: {}, rankRun: null, rankBoard: [] });
      await openGalaxySelect(page, 1);
      await expect(page.getByTestId('galaxy-1-1')).toBeEnabled();
      await expect(page.getByTestId('galaxy-1-2')).toBeDisabled();
      await page.getByTestId('galaxy-1-1').click();
      await expectMode(page, 'playing');

      await fastForward(page, CLEAR_1_1_SECONDS);
      // The next write replaces the unreadable text with a valid save.
      expect(await storedSave(page)).toMatchObject({ version: 1, frontier: '1-2' });
    });
  }

  test('a field that fails keeps the fields that pass', async ({ page }) => {
    await openWithStoredText(page, '{"version":1,"frontier":"1-3","galaxies":{"1-1":{"bestScore":900,"stars":2}},"rankRun":{"lives":"many"},"rankBoard":"x"}');

    const { save } = await gameState(page);
    expect(save).toMatchObject({ frontier: '1-3', rankRun: null, rankBoard: [], galaxies: { '1-1': { bestScore: 900, stars: 2 } } });
    await openGalaxySelect(page, 1);
    await expect(page.getByTestId('galaxy-1-3')).toBeEnabled();
    await expect(page.getByTestId('galaxy-1-4')).toBeDisabled();
  });
});
