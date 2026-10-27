import type { Page } from '@playwright/test';
import { PICKUPS } from '../src/content/pickups';
import type { PickupId } from '../src/content/types';
import { STEP_SECONDS } from '../src/sim/config';
import { expect, expectMode, fastForward, gameState, grantPickup, nextFrames, openFreshGame, openGame, pinClockSeed, playFreeGalaxy, shotsPerVolley, storedSave, test, toastOf, waitForBridge } from './fixtures';
import { seedFor } from './seeds';

/** Starts the default debug run in 1-1 and holds fire, so a volley can be counted. */
async function startFiring(page: Page): Promise<void> {
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.down('Space');
  await nextFrames(page, 3);
}

/** Drops `kind` onto the ship and steps once, which collects it. */
async function collect(page: Page, kind: PickupId): Promise<void> {
  await grantPickup(page, kind);
  await fastForward(page, STEP_SECONDS);
}

/** Pickups that run on a timer, each with the shots one trigger fires once it is collected (only Double Shot, Spread Laser and the Wingman add shots). */
const TIMED = [
  { kind: 'doubleShot', volley: 2 },
  { kind: 'spreadLaser', volley: 3 },
  { kind: 'rapidFire', volley: 1 },
  { kind: 'shield', volley: 1 },
  { kind: 'piercingBeam', volley: 1 },
  { kind: 'homingMissiles', volley: 1 },
  { kind: 'wingman', volley: 2 },
  { kind: 'timeWarp', volley: 1 },
] as const;

test.describe('a collected timed pickup', () => {
  for (const { kind, volley } of TIMED) {
    test(`${kind}: shows its pill, counts down, and fires ${String(volley)} shot${volley === 1 ? '' : 's'} per trigger`, async ({ page }) => {
      await startFiring(page);
      expect(await shotsPerVolley(page)).toBe(1);
      const before = await gameState(page);
      expect(before.effects).toEqual({});

      await collect(page, kind);
      const collected = await gameState(page);
      expect(collected.events).toMatchObject({ pickupDropped: 1, pickupCollected: 1 });
      await expect.poll(async () => (await gameState(page)).hudRects.length, 'the pickup pill is drawn').toBe(before.hudRects.length + 1);
      const left = collected.effects[kind];
      expect(left).toBeGreaterThan(0);
      expect(collected.shield).toBe(kind === 'shield');

      await fastForward(page, 0.25);
      expect((await gameState(page)).effects[kind]).toBeLessThan((left ?? 0) - 0.2);
      expect(await shotsPerVolley(page)).toBe(volley);
    });
  }
});

test('a weapon core raises the weapon tier and the volley, and has no pill', async ({ page }) => {
  await startFiring(page);
  const before = await gameState(page);
  expect(before.weaponTier).toBe(0);
  expect(await shotsPerVolley(page)).toBe(1);

  await collect(page, 'weaponCore');
  await nextFrames(page, 3);
  const after = await gameState(page);
  expect(after.weaponTier).toBe(1);
  expect(after.effects).toEqual({});
  expect(after.hudRects).toHaveLength(before.hudRects.length);
  expect(await shotsPerVolley(page)).toBe(2);
});

test('the first drop of a kind says what it does once, is remembered in the save, and stays quiet after a reload', async ({ page }) => {
  await pinClockSeed(page, seedFor('lanes-clear'));
  await openFreshGame(page);
  await playFreeGalaxy(page, '1-1');
  expect((await storedSave(page)).seenPickups).toEqual([]);

  await collect(page, 'doubleShot');
  await expect(toastOf(page)).toHaveText(PICKUPS.doubleShot.callout);
  await expect.poll(async () => (await storedSave(page)).seenPickups).toEqual(['doubleShot']);
  // Another kind is a first drop of its own.
  await collect(page, 'shield');
  await expect(toastOf(page)).toHaveText(PICKUPS.shield.callout);
  await expect.poll(async () => (await storedSave(page)).seenPickups).toEqual(['doubleShot', 'shield']);

  await page.reload();
  await waitForBridge(page);
  await playFreeGalaxy(page, '1-1');
  await collect(page, 'doubleShot');
  const again = await gameState(page);
  expect(again.events).toMatchObject({ pickupDropped: 1, pickupCollected: 1 });
  expect(again.effects.doubleShot).toBeGreaterThan(0);
  await expect(toastOf(page)).not.toContainText('New:');
  expect((await storedSave(page)).seenPickups).toEqual(['doubleShot', 'shield']);

  // The memory is per kind: one never seen still gets its callout.
  await collect(page, 'spreadLaser');
  await expect(toastOf(page)).toHaveText(PICKUPS.spreadLaser.callout);
  await expect.poll(async () => (await storedSave(page)).seenPickups).toEqual(['doubleShot', 'shield', 'spreadLaser']);
});
