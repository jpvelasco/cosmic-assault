import type { Page } from '@playwright/test';
import { defaultSave } from '../src/meta/save';
import { STEP_SECONDS } from '../src/sim/config';
import { bossHp, BOSSES } from '../src/content/bosses';
import { SEGMENT_COUNT, SEGMENT_HP } from '../src/sim/boss/leviathan';
import { ECLIPSE_CORONA } from '../src/sim/boss/eclipse';
import { EXPOSED_AT } from '../src/sim/boss/monolith';
import type { GalaxyId } from '../src/content/types';
import { startRank, type RankRun } from '../src/meta/rankRun';
import {
  clickPastGuard,
  damageBoss,
  expect,
  expectMode,
  fastForward,
  gameState,
  KILL_SHOTS,
  openFreshGame,
  openGame,
  pinClockSeed,
  seedSave,
  storedSave,
  test,
} from './fixtures';
import { BOSS_GALAXY, CARRIER_GALAXY, ECLIPSE_GALAXY, HULL_FIRE_SECONDS, LEVIATHAN_GALAXY, seedFor, TO_BOSS_FIGHT_SECONDS, WARDEN_GALAXY } from './seeds';

/** The boss as the bridge shows it; fails if the boss has not arrived. */
async function bossOf(page: Page): Promise<NonNullable<CosmicAssaultTestState['boss']>> {
  const { boss } = await gameState(page);
  if (boss === null) throw new Error('No boss yet: fast-forward through the approach first');
  return boss;
}

/**
 * Plays boss galaxy `galaxy` from the map in Free play, with the save's frontier there and the clock seed `seed`, so its
 * clear is saved; the next Dimension is still shut on the way.
 */
async function playBossFromMap(page: Page, galaxy: GalaxyId, seed: number): Promise<void> {
  const dimension = Number(galaxy.slice(0, 1));
  await seedSave(page, { ...defaultSave(), frontier: galaxy });
  await pinClockSeed(page, seed);
  await openFreshGame(page);
  await page.getByTestId('play').click();
  await page.getByTestId('mode-free').click();
  await expect(page.getByTestId(`dimension-${String(dimension + 1)}`)).toBeDisabled();
  await page.getByTestId(`dimension-${String(dimension)}`).click();
  await page.getByTestId(`galaxy-${galaxy}`).click();
  await expectMode(page, 'playing');
}

/** Kills the fighting boss and checks the clear opened the next Dimension: saved, and on the map with its first galaxy open. */
async function killAndOpenNextDimension(page: Page, galaxy: GalaxyId): Promise<void> {
  const dimension = Number(galaxy.slice(0, 1)) + 1;
  const first = `${String(dimension)}-1`;
  await damageBoss(page, KILL_SHOTS);
  // The killing blow ends the galaxy on the next step.
  await fastForward(page, STEP_SECONDS);
  const { screen, galaxy: played } = await gameState(page);
  expect({ screen, galaxy: played }).toEqual({ screen: 'results', galaxy });
  await expect(page.getByRole('heading', { name: 'Galaxy cleared' })).toBeVisible();
  const stored = await storedSave(page);
  expect(stored.frontier).toBe(first);
  expect(stored.galaxies?.[galaxy]?.stars).toBeGreaterThan(0);
  await clickPastGuard(page, 'results-map', 'map');
  await expect(page.getByTestId(`dimension-${String(dimension)}`)).toBeEnabled();
  await page.getByTestId(`dimension-${String(dimension)}`).click();
  await expect(page.getByTestId(`galaxy-${first}`)).toBeEnabled();
}

test.describe(`the Monolith in ${BOSS_GALAXY}`, () => {
  test('is shielded while four or more shards remain, bare after, and its defeat opens the next Dimension', async ({ page }) => {
    await playBossFromMap(page, BOSS_GALAXY, seedFor('boss-fight'));

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    const shielded = await bossOf(page);
    expect(shielded).toMatchObject({ id: 'monolith', state: 'fighting', vulnerable: false });
    expect(shielded.liveParts).toBeGreaterThan(EXPOSED_AT);
    // A shielded core offers a shard as the only place a shot does harm.
    expect(shielded.target).not.toBeNull();

    // One shard down: the core stays shielded and untouched while four or more remain.
    await damageBoss(page, 1);
    const hit = await bossOf(page);
    expect(hit).toMatchObject({ liveParts: shielded.liveParts - 1, hp: shielded.maxHp });
    expect(hit.vulnerable).toBe(false);

    // Clear the shards down to the last three: the core is bare, and the next step announces it.
    await damageBoss(page, hit.liveParts - EXPOSED_AT);
    await fastForward(page, STEP_SECONDS);
    const bare = await bossOf(page);
    expect(bare).toMatchObject({ liveParts: EXPOSED_AT, vulnerable: true, hp: shielded.maxHp });
    expect((await gameState(page)).events).toMatchObject({ bossExposed: 1 });

    await damageBoss(page, 1);
    expect((await bossOf(page)).hp).toBe(shielded.maxHp - 1);
    await killAndOpenNextDimension(page, BOSS_GALAXY);
  });
});

test.describe(`the Hive Carrier in ${CARRIER_GALAXY}`, () => {
  test('turns a shot away from its shut hangar, opens it with a launch, and falls to shots through it', async ({ page }) => {
    await openGame(page, { seed: seedFor('hangar-opens'), galaxy: CARRIER_GALAXY });
    await page.keyboard.press('Space');
    await expectMode(page, 'playing');

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    const shut = await bossOf(page);
    expect(shut).toMatchObject({ id: 'hiveCarrier', state: 'fighting', vulnerable: false, target: null });

    // Fire at the hull before the first launch: the shut hangar turns the shot away and takes no damage.
    await page.keyboard.down('Space');
    await fastForward(page, HULL_FIRE_SECONDS);
    await page.keyboard.up('Space');
    expect((await gameState(page)).events.bossDeflected).toBeGreaterThan(0);
    expect((await bossOf(page)).hp).toBe(shut.maxHp);

    // Its first launch opens the hangar: drones come out and the weak point is on offer.
    await expect
      .poll(async () => {
        await fastForward(page, 0.1);
        return (await bossOf(page)).vulnerable;
      }, 'the hangar opens after a launch')
      .toBe(true);
    const open = await gameState(page);
    expect(open.events).toMatchObject({ hangarOpen: 1 });
    expect(open.boss?.target).not.toBeNull();
    expect(open.foes.some((foe) => foe.kind === 'drone')).toBe(true);

    await damageBoss(page, 1);
    expect((await bossOf(page)).hp).toBe(shut.maxHp - 1);
    await damageBoss(page, KILL_SHOTS);
    await fastForward(page, STEP_SECONDS);
    const { screen, galaxy } = await gameState(page);
    expect({ screen, galaxy }).toEqual({ screen: 'results', galaxy: CARRIER_GALAXY });
    await expect(page.getByRole('heading', { name: 'Galaxy cleared' })).toBeVisible();
  });
});

const WARDEN_HP = bossHp(BOSSES.warden, 3);

test.describe(`the Warden in ${WARDEN_GALAXY}`, () => {
  test('arrives inside its ring of 14 turrets with its core open, and its defeat opens Void Rift', async ({ page }) => {
    await playBossFromMap(page, WARDEN_GALAXY, seedFor('warden-fight'));

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    const warden = await bossOf(page);
    expect(warden).toMatchObject({ id: 'warden', state: 'fighting', vulnerable: true, liveParts: 14, hp: WARDEN_HP, maxHp: WARDEN_HP });
    // Its core can always be hurt, so a blow lands on the core, not on a turret.
    await damageBoss(page, 1);
    expect(await bossOf(page)).toMatchObject({ hp: WARDEN_HP - 1, liveParts: 14 });

    await killAndOpenNextDimension(page, WARDEN_GALAXY);
  });
});

test.describe(`the Leviathan in ${LEVIATHAN_GALAXY}`, () => {
  test('is hurt only on its tail, lays its head bare once the last segment breaks, and its defeat opens Singularity', async ({ page }) => {
    await playBossFromMap(page, LEVIATHAN_GALAXY, seedFor('leviathan-fight'));

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    const whole = await bossOf(page);
    expect(whole).toMatchObject({ id: 'leviathan', state: 'fighting', vulnerable: false, liveParts: SEGMENT_COUNT });
    // A shielded head offers the tail as the only place a shot does harm.
    expect(whole.target).not.toBeNull();

    // Its HP in blows breaks the tail, and the break takes its share off the head.
    await damageBoss(page, SEGMENT_HP);
    expect(await bossOf(page)).toMatchObject({ liveParts: SEGMENT_COUNT - 1, hp: whole.maxHp - (BOSSES.leviathan.partBreakDamage ?? 0), vulnerable: false });

    // The rest of the body, tail first: the head is bare, and the next step announces it.
    await damageBoss(page, (SEGMENT_COUNT - 1) * SEGMENT_HP);
    await fastForward(page, STEP_SECONDS);
    const bare = await bossOf(page);
    expect(bare).toMatchObject({ liveParts: 0, vulnerable: true });
    expect((await gameState(page)).events).toMatchObject({ bossExposed: 1 });

    await damageBoss(page, 1);
    expect((await bossOf(page)).hp).toBe(bare.hp - 1);
    await killAndOpenNextDimension(page, LEVIATHAN_GALAXY);
  });
});

const ECLIPSE_HP = bossHp(BOSSES.eclipse, 5);

test.describe(`the Eclipse in ${ECLIPSE_GALAXY}`, () => {
  test('is shielded by its corona, bare once four shards remain, and its defeat ends a Rank run on Rank complete', async ({ page }) => {
    // A Rank run waiting at the last galaxy, as the one before it left it.
    const run: RankRun = { ...startRank('2026-10-28'), next: ECLIPSE_GALAXY, score: 4000 };
    await seedSave(page, { ...defaultSave(), frontier: ECLIPSE_GALAXY, rankRun: run, rankSeq: 1 }, { once: true });
    await pinClockSeed(page, seedFor('eclipse-rank'));
    await openFreshGame(page);
    await page.getByTestId('resume-rank').click();
    await expectMode(page, 'playing');
    expect((await gameState(page)).galaxy).toBe(ECLIPSE_GALAXY);

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    const shielded = await bossOf(page);
    expect(shielded).toMatchObject({ id: 'eclipse', state: 'fighting', vulnerable: false, liveParts: ECLIPSE_CORONA.counts[0], hp: ECLIPSE_HP, maxHp: ECLIPSE_HP });
    // A shielded core offers a shard as the only place a shot does harm.
    expect(shielded.target).not.toBeNull();

    // Two blows break a shard: the corona comes down to its exposure, and the next step lays the core bare.
    await damageBoss(page, ECLIPSE_CORONA.hp * (shielded.liveParts - ECLIPSE_CORONA.exposedAt));
    await fastForward(page, STEP_SECONDS);
    const bare = await bossOf(page);
    expect(bare).toMatchObject({ liveParts: ECLIPSE_CORONA.exposedAt, vulnerable: true, hp: ECLIPSE_HP });
    expect((await gameState(page)).events).toMatchObject({ bossExposed: 1 });

    await damageBoss(page, 1);
    expect((await bossOf(page)).hp).toBe(ECLIPSE_HP - 1);

    await damageBoss(page, KILL_SHOTS);
    // The killing blow ends the galaxy, and with it the run: no next galaxy, only the end of the campaign.
    await fastForward(page, STEP_SECONDS);
    const { screen, galaxy, rankRun } = await gameState(page);
    expect({ screen, galaxy, rankRun }).toEqual({ screen: 'rankComplete', galaxy: ECLIPSE_GALAXY, rankRun: null });
    await expect(page.getByRole('heading', { name: 'Rank complete' })).toBeVisible();
    await expect(page.getByTestId('results-next')).toBeHidden();
    const stored = await storedSave(page);
    expect(stored.rankRun).toBeNull();
    expect(stored.rankBoard).toEqual([expect.objectContaining({ reached: 'D5 · ★', continued: false })]);
    expect(stored.rankBoard?.[0]?.score).toBeGreaterThan(run.score);
  });
});
