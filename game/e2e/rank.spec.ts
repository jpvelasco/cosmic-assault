import type { Page } from '@playwright/test';
import { STALE_RUN_NOTICE } from '../src/app/flowController';
import { startRank, type RankRun } from '../src/meta/rankRun';
import { SAVE_KEY } from '../src/meta/save';
import { expect, expectMode, gameState, openFreshGame, test, waitForBridge } from './fixtures';

/** Plays a new Rank run from the title. */
async function startRankRun(page: Page): Promise<void> {
  await page.getByTestId('play').click();
  await page.getByTestId('mode-rank').click();
  await expectMode(page, 'playing');
}

/** Pauses (if the run is still in play) and quits from the pause card. */
async function quitRun(page: Page): Promise<void> {
  if ((await gameState(page)).screen === 'playing') await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await page.getByTestId('quit').click();
  await expectMode(page, 'title');
}

/** Stores `run` as the save's Rank run before the page's first load (and only then). */
async function seedRun(page: Page, run: RankRun): Promise<void> {
  await page.addInitScript(
    ([key, saved]) => {
      if (sessionStorage.getItem('seeded') !== null) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, JSON.stringify({ version: 1, frontier: '1-3', rankRun: saved, rankSeq: 1 }));
    },
    [SAVE_KEY, run] as const,
  );
}

test('Quit mid-galaxy costs a life, keeps the score from before it, and leaves Resume Rank', async ({ page }) => {
  await openFreshGame(page);
  await startRankRun(page);
  expect((await gameState(page)).save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quit')).toHaveText('Quit (costs a life)');

  await quitRun(page);
  await expect(page.getByTestId('resume-rank')).toHaveText('Resume Rank');
  expect((await gameState(page)).save.rankRun).toMatchObject({ next: '1-1', score: 0, lives: 2, inGalaxy: false });
  // The forfeit is taken once: a reload finds the run as Quit left it.
  await page.reload();
  await waitForBridge(page);
  expect((await gameState(page)).save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
});

test('a reload mid-galaxy forfeits it the same way, once no tab answers for it', async ({ page }) => {
  await openFreshGame(page);
  await startRankRun(page);
  await page.reload();
  await waitForBridge(page);

  await expect.poll(async () => (await gameState(page)).save.rankRun).toMatchObject({ next: '1-1', lives: 2, inGalaxy: false });
  expect((await gameState(page)).screen).toBe('title');
  await expect(page.getByTestId('resume-rank')).toBeEnabled();
  await expect(page.getByTestId('rank-elsewhere')).toBeHidden();
});

test('a Quit on the last life loses the run; the title offers a Continue, which resets the score', async ({ page }) => {
  await seedRun(page, { ...startRank('2026-10-26'), next: '1-3', score: 1500, lives: 1 });
  await openFreshGame(page);
  await page.getByTestId('resume-rank').click();
  await expectMode(page, 'playing');
  expect((await gameState(page)).lives).toBe(1);

  await quitRun(page);
  const resume = page.getByTestId('resume-rank');
  await expect(resume).toHaveText('Continue Rank (score resets)');
  const { save } = await gameState(page);
  expect(save.rankBoard).toEqual([expect.objectContaining({ score: 1500, reached: 'D1 · G3', continued: false })]);

  await resume.click();
  await expectMode(page, 'playing');
  const { lives, rankRun } = await gameState(page);
  expect(lives).toBe(3);
  expect(rankRun).toMatchObject({ next: '1-3', score: 0, continued: true });
});

test('a new Rank run over a saved one asks first, and posts the run it ends', async ({ page }) => {
  await seedRun(page, { ...startRank('2026-10-25'), next: '1-3', score: 2200, lives: 2 });
  await openFreshGame(page);
  await page.getByTestId('play').click();
  await page.getByTestId('mode-rank').click();
  await expectMode(page, 'confirmNewRank');
  await expect(page.getByText('Your saved run will end.')).toBeVisible();
  await page.getByTestId('back').click();
  await expectMode(page, 'modeSelect');
  expect((await gameState(page)).save.rankRun).toMatchObject({ next: '1-3', score: 2200 });

  await page.getByTestId('mode-rank').click();
  await page.getByTestId('confirm-new-rank').click();
  await expectMode(page, 'playing');
  const { save } = await gameState(page);
  expect(save.rankRun).toMatchObject({ next: '1-1', score: 0, lives: 3 });
  expect(save.rankBoard).toEqual([expect.objectContaining({ score: 2200, reached: 'D1 · G3', continued: false })]);
});

/** The save as stored, read in `page`. */
async function stored(page: Page): Promise<{ rankRun?: Partial<RankRun> }> {
  return JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? '{}') as { rankRun?: Partial<RankRun> };
}

test('a second tab leaves the first tab live attempt alone, and offers Resume once it ends', async ({ page, context }) => {
  await openFreshGame(page);
  await startRankRun(page);
  const other = await context.newPage();
  await openFreshGame(other);

  // The playing tab answers the probe: no forfeit, and this tab says where the run is.
  await expect(other.getByTestId('rank-elsewhere')).toHaveText('This run is playing in another tab');
  await expect(other.getByTestId('resume-rank')).toBeDisabled();
  expect((await stored(other)).rankRun).toMatchObject({ lives: 3, inGalaxy: true });

  await page.bringToFront();
  await quitRun(page);
  await expect(page.getByText(STALE_RUN_NOTICE)).toBeHidden();
  expect((await stored(page)).rankRun).toMatchObject({ lives: 2, inGalaxy: false });
  // The first tab's own Quit ends the galaxy, so the second tab may resume it now.
  await expect(other.getByTestId('resume-rank')).toBeEnabled();
  await expect(other.getByTestId('rank-elsewhere')).toBeHidden();
});

test('a tab whose Rank run another tab replaced does not write over it, and says so', async ({ page, context }) => {
  await openFreshGame(page);
  await startRankRun(page);
  // A second tab starts a new run over the one the first is playing.
  const other = await context.newPage();
  await openFreshGame(other);
  await other.getByTestId('play').click();
  await other.getByTestId('mode-rank').click();
  await other.getByTestId('confirm-new-rank').click();
  await expectMode(other, 'playing');

  await page.bringToFront();
  await quitRun(page);
  await expect(page.getByText(STALE_RUN_NOTICE)).toBeVisible();
  // The first tab's forfeit was dropped: the stored run is the second tab's new one, untouched.
  expect((await stored(page)).rankRun).toMatchObject({ next: '1-1', lives: 3, inGalaxy: true });
});
