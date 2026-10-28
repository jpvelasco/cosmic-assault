import type { Page } from '@playwright/test';
import { defaultSave, type SaveData } from '../src/meta/save';
import { STEP_SECONDS } from '../src/sim/config';
import { EXPOSED_AT } from '../src/sim/boss/monolith';
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
import { BOSS_GALAXY, CARRIER_GALAXY, HULL_FIRE_SECONDS, seedFor, TO_BOSS_FIGHT_SECONDS } from './seeds';

/** The boss as the bridge shows it; fails if the boss has not arrived. */
async function bossOf(page: Page): Promise<NonNullable<CosmicAssaultTestState['boss']>> {
  const { boss } = await gameState(page);
  if (boss === null) throw new Error('No boss yet: fast-forward through the approach first');
  return boss;
}

test.describe(`the Monolith in ${BOSS_GALAXY}`, () => {
  test('is shielded while four or more shards remain, bare after, and its defeat opens the next Dimension', async ({ page }) => {
    const save: SaveData = { ...defaultSave(), frontier: BOSS_GALAXY };
    await seedSave(page, save);
    await pinClockSeed(page, seedFor('boss-fight'));
    await openFreshGame(page);
    await page.getByTestId('play').click();
    await page.getByTestId('mode-free').click();
    await expect(page.getByTestId('dimension-2')).toBeDisabled();
    await page.getByTestId('dimension-1').click();
    await page.getByTestId(`galaxy-${BOSS_GALAXY}`).click();
    await expectMode(page, 'playing');

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

    await damageBoss(page, KILL_SHOTS);
    // The killing blow ends the galaxy on the next step: the boss dies under the results card.
    await fastForward(page, STEP_SECONDS);
    expect((await gameState(page)).screen).toBe('results');
    await expect(page.getByRole('heading', { name: 'Galaxy cleared' })).toBeVisible();
    const stored = await storedSave(page);
    expect(stored.frontier).toBe('2-1');
    expect(stored.galaxies?.[BOSS_GALAXY]?.stars).toBeGreaterThan(0);
    await clickPastGuard(page, 'results-map', 'map');
    await expect(page.getByTestId('dimension-2')).toBeEnabled();
    await page.getByTestId('dimension-2').click();
    await expect(page.getByTestId('galaxy-2-1')).toBeEnabled();
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

/** The Warden's galaxy. Its case leans on no seed: five lives carry the idle ship through the approach whatever hits it. */
const WARDEN_GALAXY = '3-6';

test.describe(`the Warden in ${WARDEN_GALAXY}`, () => {
  test('arrives inside its ring of 14 turrets with its core open, and its defeat records the clear', async ({ page }) => {
    await openGame(page, { galaxy: WARDEN_GALAXY, lives: 5 });
    await page.keyboard.press('Space');
    await expectMode(page, 'playing');

    await fastForward(page, TO_BOSS_FIGHT_SECONDS);
    const warden = await bossOf(page);
    expect(warden).toMatchObject({ id: 'warden', state: 'fighting', vulnerable: true, liveParts: 14, hp: 76, maxHp: 76 });
    // Its core can always be hurt, so a blow lands on the core, not on a turret.
    await damageBoss(page, 1);
    expect(await bossOf(page)).toMatchObject({ hp: 75, liveParts: 14 });

    await damageBoss(page, KILL_SHOTS);
    // The killing blow ends the galaxy on the next step.
    await fastForward(page, STEP_SECONDS);
    const { screen, galaxy, save } = await gameState(page);
    expect({ screen, galaxy }).toEqual({ screen: 'results', galaxy: WARDEN_GALAXY });
    await expect(page.getByRole('heading', { name: 'Galaxy cleared' })).toBeVisible();
    expect(save.galaxies[WARDEN_GALAXY]?.stars).toBeGreaterThan(0);
  });
});
