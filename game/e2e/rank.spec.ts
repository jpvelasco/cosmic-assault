import type { Page } from '@playwright/test';
import { STALE_RUN_NOTICE } from '../src/app/flowController';
import { LEFT_RUN_NOTICE } from '../src/app/runController';
import { RANK_START_LIVES, startRank, type RankRun } from '../src/meta/rankRun';
import { defaultSave } from '../src/meta/save';
import { clickPastGuard, expect, expectMode, fastForward, gameState, openFreshGame, pinClockSeed, seedSave, storedSave, test, toastOf, waitForBridge } from './fixtures';
import { CLEAR_1_1_SECONDS, GAME_OVER_GALAXY, seedFor, THREE_DEATHS_SECONDS } from './seeds';

/** Plays a new Rank run from the title. */
async function startRankRun(page: Page): Promise<void> {
  await page.getByTestId('play').click();
  await page.getByTestId('mode-rank').click();
  await expectMode(page, 'playing');
}

/**
 * How long a check that waits on a rendered frame may take: keys are queued and applied by the next animation frame,
 * which a loaded headless browser can starve for longer than the default 5 s.
 */
const FRAME_TIMEOUT_MS = 15000;

/** Pauses with Escape, but only a run still in play: a pause that is already on would be toggled off by another press. */
async function pauseRun(page: Page): Promise<void> {
  if ((await gameState(page)).screen === 'playing') await page.keyboard.press('Escape');
  await expectMode(page, 'paused', { timeout: FRAME_TIMEOUT_MS });
}

/** Pauses (if the run is still in play) and quits from the pause card. */
async function quitRun(page: Page): Promise<void> {
  await pauseRun(page);
  await page.getByTestId('quit').click();
  await expectMode(page, 'title', { timeout: FRAME_TIMEOUT_MS });
}

/** Stores `run` as the save's Rank run before the page's first load (and only then). */
function seedRun(page: Page, run: RankRun): Promise<void> {
  return seedSave(page, { ...defaultSave(), frontier: '1-3', rankRun: run, rankSeq: 1 }, { once: true });
}

test('Quit mid-galaxy costs a life, keeps the score from before it, and leaves Resume Rank', async ({ page }) => {
  // Pinned: the unseeded run flew a different 1-1 each time, in real time, until a frame applied the pause.
  await pinClockSeed(page, seedFor('clears-1-1'));
  await openFreshGame(page);
  await startRankRun(page);
  expect((await gameState(page)).save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
  await pauseRun(page);
  await expect(page.getByTestId('quit')).toHaveText('Quit (costs a life)', { timeout: FRAME_TIMEOUT_MS });

  await quitRun(page);
  await expect(page.getByTestId('resume-rank')).toHaveText('Resume Rank');
  expect((await gameState(page)).save.rankRun).toMatchObject({ next: '1-1', score: 0, lives: 2, inGalaxy: false });
  // The forfeit is taken once: a reload finds the run as Quit left it.
  await page.reload();
  await waitForBridge(page);
  expect((await gameState(page)).save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
});

/**
 * Fast-forwards the idle run a second at a time until it has lost `count` lives. A respawned ship is invulnerable for
 * longer than a second, so no step costs two; the 'three-deaths' seed loses three within THREE_DEATHS_SECONDS (e2eSeeds.test.ts).
 */
async function loseLives(page: Page, count: number): Promise<void> {
  const target = (await gameState(page)).lives - count;
  for (let s = 0; s < THREE_DEATHS_SECONDS && (await gameState(page)).lives > target; s++) await fastForward(page, 1);
  expect((await gameState(page)).lives).toBe(target);
}

/** Resumes a seeded five-life run of GAME_OVER_GALAXY, whose idle ship the 'three-deaths' seed soon hits. */
async function playFiveLifeRun(page: Page): Promise<void> {
  await pinClockSeed(page, seedFor('three-deaths'));
  await seedRun(page, { ...startRank('2026-10-26'), next: GAME_OVER_GALAXY, score: 700, lives: 5 });
  await openFreshGame(page);
  await page.getByTestId('resume-rank').click();
  await expectMode(page, 'playing');
}

test('Quit after two deaths forfeits from the lives left: three down from the galaxy start, never more', async ({ page }) => {
  await playFiveLifeRun(page);
  await loseLives(page, 2);
  // Each death is saved as it happens, still in the galaxy.
  expect((await storedSave(page)).rankRun).toMatchObject({ lives: 3, inGalaxy: true });

  await quitRun(page);
  expect((await storedSave(page)).rankRun).toMatchObject({ next: GAME_OVER_GALAXY, score: 700, lives: 2, inGalaxy: false });
});

test('a reload after a death forfeits from the lives left, not from the galaxy start', async ({ page }) => {
  await playFiveLifeRun(page);
  await loseLives(page, 1);
  await page.reload();
  await waitForBridge(page);

  await expect.poll(async () => (await gameState(page)).save.rankRun).toMatchObject({ lives: 3, score: 700, inGalaxy: false });
});

test('a reload mid-galaxy forfeits it the same way, once no tab answers for it', async ({ page }) => {
  await openFreshGame(page);
  await startRankRun(page);
  await page.reload();
  await waitForBridge(page);

  await expect.poll(async () => (await gameState(page)).save.rankRun).toMatchObject({ next: '1-1', lives: 2, inGalaxy: false });
  // The player is told why: the run was left mid-galaxy.
  await expect(toastOf(page)).toHaveText(LEFT_RUN_NOTICE);
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

test('a second tab leaves the first tab live attempt alone, and offers Resume once it ends', async ({ page, context }) => {
  await openFreshGame(page);
  await startRankRun(page);
  const other = await context.newPage();
  await openFreshGame(other);

  // The playing tab answers the probe: no forfeit, and this tab says where the run is.
  await expect(other.getByTestId('rank-elsewhere')).toHaveText('This run is playing in another tab');
  await expect(other.getByTestId('resume-rank')).toBeDisabled();
  expect((await storedSave(other)).rankRun).toMatchObject({ lives: 3, inGalaxy: true });

  await page.bringToFront();
  await quitRun(page);
  await expect(page.getByText(STALE_RUN_NOTICE)).toBeHidden();
  expect((await storedSave(page)).rankRun).toMatchObject({ lives: 2, inGalaxy: false });
  // The first tab's own Quit ends the galaxy, so the second tab may resume it now.
  await expect(other.getByTestId('resume-rank')).toBeEnabled();
  await expect(other.getByTestId('rank-elsewhere')).toBeHidden();
});

test('a new tab that is busy right after it starts a Rank run does not cost the run a life', async ({ page, context }) => {
  await openFreshGame(page);
  const other = await context.newPage();
  await openFreshGame(other);
  await other.getByTestId('play').click();
  // A listener added after the app's own click handler runs in the same task, once the Rank run is written and claimed:
  // the new tab then stays busy for half a second, as while it builds the galaxy, before it can answer a probe.
  await other.evaluate(() => {
    document.querySelector('[data-testid="mode-rank"]')?.addEventListener(
      'click',
      () => {
        const end = performance.now() + 500;
        while (performance.now() < end) {
          // Busy on purpose.
        }
      },
      { once: true },
    );
  });
  await other.getByTestId('mode-rank').click();
  await expectMode(other, 'playing');

  await expect(page.getByTestId('rank-elsewhere')).toBeVisible();
  await expect(page.getByText(LEFT_RUN_NOTICE)).toBeHidden();
  expect((await storedSave(page)).rankRun).toMatchObject({ lives: 3, inGalaxy: true });
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
  expect((await storedSave(page)).rankRun).toMatchObject({ next: '1-1', lives: 3, inGalaxy: true });
});

test('a Rank clear is saved at once, and Resume Rank after a reload plays on with the same score and lives', async ({ page }) => {
  await pinClockSeed(page, seedFor('clears-1-1'));
  await openFreshGame(page);
  await startRankRun(page);
  await fastForward(page, CLEAR_1_1_SECONDS);

  const { screen, galaxy, rankRun, save } = await gameState(page);
  expect({ screen, galaxy }).toEqual({ screen: 'results', galaxy: '1-1' });
  // The run waits between galaxies at the next one, with the clear's score; the save has it before any other input.
  expect(rankRun).toMatchObject({ next: '1-2', inGalaxy: false });
  const carried = rankRun;
  expect(carried?.score).toBeGreaterThan(0);
  expect(await storedSave(page)).toMatchObject({ frontier: '1-2', rankRun: { next: '1-2', score: carried?.score, lives: carried?.lives, inGalaxy: false } });
  expect(save.rankSeq).toBeGreaterThan(0);

  // Leaving the results card for the title keeps the win, and the title offers the run.
  await clickPastGuard(page, 'rank-title', 'title');
  await page.reload();
  await waitForBridge(page);
  const resume = page.getByTestId('resume-rank');
  await expect(resume).toHaveText('Resume Rank');
  await expect(resume).toBeEnabled();
  expect((await gameState(page)).save.rankRun).toEqual(carried);

  await resume.click();
  await expectMode(page, 'playing');
  const resumed = await gameState(page);
  expect(resumed.galaxy).toBe('1-2');
  expect(resumed.lives).toBe(carried?.lives);
  expect(resumed.rankRun).toMatchObject({ next: '1-2', score: carried?.score, lives: carried?.lives, inGalaxy: true });
});

test('a game over offers Continue, which resets the score and marks the run, and the board then shows it', async ({ page }) => {
  // One life left at the game-over galaxy: the 'one-life-death' seed's idle ship loses it a few seconds in.
  await pinClockSeed(page, seedFor('one-life-death'));
  await seedRun(page, { ...startRank('2026-10-26'), next: GAME_OVER_GALAXY, score: 1500, lives: 1 });
  await openFreshGame(page);
  await page.getByTestId('resume-rank').click();
  await expectMode(page, 'playing');
  await fastForward(page, 60);
  await expectMode(page, 'gameOver');

  // The run is lost with its total on the board, waiting for a Continue.
  const lost = await storedSave(page);
  expect(lost.rankRun).toMatchObject({ next: GAME_OVER_GALAXY, lives: 0, continued: false, inGalaxy: false });
  expect(lost.rankBoard).toEqual([expect.objectContaining({ continued: false })]);
  const firstEntry = lost.rankBoard?.[0];
  expect(firstEntry?.score).toBeGreaterThanOrEqual(1500);
  // The card shows the run total the board posted, not just this galaxy's score.
  await expect(page.locator('.end-line--total')).toHaveText(`Run total${String(firstEntry?.score)}`);

  await clickPastGuard(page, 'rank-continue', 'playing');
  const { lives, score, rankRun } = await gameState(page);
  expect({ lives, score }).toEqual({ lives: RANK_START_LIVES, score: 0 });
  expect(rankRun).toMatchObject({ next: GAME_OVER_GALAXY, score: 0, lives: RANK_START_LIVES, continued: true, inGalaxy: true });
  expect((await storedSave(page)).rankRun).toMatchObject({ score: 0, continued: true });

  // Lose the continued run too: its entry carries the continued flag, beside the first one.
  await fastForward(page, THREE_DEATHS_SECONDS);
  await expectMode(page, 'gameOver');
  const { rankBoard } = await storedSave(page);
  expect(rankBoard).toHaveLength(2);
  expect(rankBoard).toEqual(expect.arrayContaining([firstEntry, expect.objectContaining({ continued: true })]));
});
