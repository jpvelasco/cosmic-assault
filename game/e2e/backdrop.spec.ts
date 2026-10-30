import type { Page } from '@playwright/test';
import { BOSS_PIECES } from '../src/render/backdropSpec';
import { dailyGalaxy } from '../src/meta/dailyGalaxy';
import { BOSS_GALAXY, dateFor } from './seeds';
import { expect, fastForward, gameState, openDaily, openGame, playDaily, startRun, test } from './fixtures';

/** Starts the run the title is set to, and returns the sky the bridge reports for it. */
async function skyOfRun(page: Page, isMobile: boolean) {
  await startRun(page, isMobile);
  return (await gameState(page)).backdrop;
}

test('two galaxies of one Dimension are drawn with different skies', async ({ page, isMobile }) => {
  await openGame(page, { galaxy: '1-1' });
  const first = await skyOfRun(page, isMobile);
  expect(first).toMatchObject({ boss: false });
  await openGame(page, { galaxy: '1-2' });
  const second = await skyOfRun(page, isMobile);
  expect(second.seed).not.toBe(first.seed);
});

test('the same galaxy is drawn with the same sky every time', async ({ page, isMobile }) => {
  await openGame(page, { galaxy: '1-1' });
  const first = await skyOfRun(page, isMobile);
  await openGame(page, { galaxy: '1-1' });
  expect(await skyOfRun(page, isMobile)).toEqual(first);
});

test("a boss galaxy's sky carries its Dimension's boss piece", async ({ page, isMobile }) => {
  await openGame(page, { galaxy: BOSS_GALAXY });
  expect(await skyOfRun(page, isMobile)).toMatchObject({ boss: true, piece: BOSS_PIECES[1] });
  await fastForward(page, 1);
  expect((await gameState(page)).screen).toBe('playing');
});

test("a Daily is drawn with a sky of its own, not its anchor's Free-play sky", async ({ page, isMobile }) => {
  const date = dateFor('daily-clears');
  const { def } = dailyGalaxy(date);
  await openGame(page, { galaxy: def.id });
  const anchor = await skyOfRun(page, isMobile);
  await openDaily(page, date);
  await playDaily(page, isMobile ? 'tap' : 'click');
  const daily = (await gameState(page)).backdrop;
  expect(daily.seed).not.toBe(anchor.seed);
  expect(daily.boss).toBe(false);
  await fastForward(page, 1);
  expect((await gameState(page)).screen).toBe('playing');
});
