import { expect, expectMode, fastForward, gameState, openGame, test } from './fixtures';
import { ION_REACH_GALAXY, seedFor, WELL_PULL_SECONDS, WELL_WARNING_SECONDS } from './seeds';

test.describe(`Ion Reach ${ION_REACH_GALAXY}`, () => {
  test('the bridge lists the foes on the field and the gravity well, first telegraphed and then pulling', async ({ page }) => {
    await openGame(page, { seed: seedFor('ion-reach-hazards'), galaxy: ION_REACH_GALAXY });
    await page.keyboard.press('Space');
    await expectMode(page, 'playing');
    expect(await gameState(page)).toMatchObject({ foes: [], wells: [] });

    await fastForward(page, WELL_WARNING_SECONDS);
    const warning = await gameState(page);
    expect(warning.screen).toBe('playing');
    expect(warning.wells).toHaveLength(1);
    expect(warning.wells[0]).toMatchObject({ stage: 'warning', intensity: 2 });
    expect(warning.wells[0]?.remaining).toBeGreaterThan(0);
    expect(warning.wells[0]?.remaining).toBeLessThanOrEqual(2);
    expect(warning.foes.length).toBeGreaterThan(0);
    for (const foe of warning.foes) expect(['splitter', 'drone']).toContain(foe.kind);

    await fastForward(page, WELL_PULL_SECONDS);
    const active = await gameState(page);
    expect(active.wells[0]).toMatchObject({ id: warning.wells[0]?.id, stage: 'active', x: warning.wells[0]?.x, y: warning.wells[0]?.y });
  });
});
