import { expect, expectMode, fastForward, gameState, openGame, test } from './fixtures';

const LOOKS = [
  ['3-1', 'crimsonNebula'],
  ['4-1', 'voidRift'],
  ['5-1', 'singularity'],
] as const;

test.describe('the last three level sets', () => {
  for (const [galaxy, look] of LOOKS) {
    test(`a run in ${galaxy} puts the bridge palette and music theme to ${look}`, { tag: '@desktop' }, async ({ page }) => {
      await openGame(page, { galaxy });
      expect(await gameState(page)).toMatchObject({ palette: 'drift', musicTheme: 'drift' });
      await page.keyboard.press('Space');
      await expectMode(page, 'playing');
      expect((await gameState(page)).palette).toBe(look);
      // The theme follows the galaxy's first step, where the galaxy starts.
      await fastForward(page, 0.1);
      expect((await gameState(page)).musicTheme).toBe(look);
    });
  }

  test('a tap starts 5-1 on a phone in the Singularity palette and music', { tag: '@phone' }, async ({ page }) => {
    await openGame(page, { galaxy: '5-1' });
    await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
    await expectMode(page, 'playing');
    expect((await gameState(page)).palette).toBe('singularity');
    await fastForward(page, 0.1);
    expect((await gameState(page)).musicTheme).toBe('singularity');
  });
});
