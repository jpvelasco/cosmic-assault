import { describe, expect, it, vi } from 'vitest';
import { createCardToggle, SETTINGS_SCREENS } from '../../src/app/cardToggle';
import type { Screen } from '../../src/app/flow';
import type { Cover } from '../../src/app/inputRouting';

function settingsToggle(screen: Screen, covers: readonly Cover[] = ['none']) {
  const card = { show: vi.fn(), hide: vi.fn() };
  const deps = { opensOn: SETTINGS_SCREENS, screen: () => screen, covers: () => covers, syncView: vi.fn(), focusOpener: vi.fn() };
  return { toggle: createCardToggle(card, deps), card, deps };
}

describe('the settings card toggle', () => {
  it.each(['title', 'modeSelect', 'paused'] as const)('opens on %s, where its chip is', (screen) => {
    const { toggle, card } = settingsToggle(screen);
    toggle.show();
    expect(toggle.open).toBe(true);
    expect(card.show).toHaveBeenCalledOnce();
  });

  it.each(['playing', 'map', 'galaxySelect', 'results'] as const)('stays shut on %s, which has no Settings chip', (screen) => {
    const { toggle, card } = settingsToggle(screen);
    toggle.show();
    expect(toggle.open).toBe(false);
    expect(card.show).not.toHaveBeenCalled();
  });

  it('closes back to the card that opened it, focus on its chip', () => {
    const { toggle, card, deps } = settingsToggle('modeSelect');
    toggle.show();
    toggle.close();
    expect(toggle.open).toBe(false);
    expect(card.hide).toHaveBeenCalledOnce();
    expect(deps.focusOpener).toHaveBeenCalledOnce();
  });

  it('stays up under the rotate prompt, however closing is asked', () => {
    const { toggle, deps } = settingsToggle('modeSelect', ['settings', 'rotate']);
    toggle.show();
    toggle.close();
    expect(toggle.open).toBe(true);
    expect(deps.focusOpener).not.toHaveBeenCalled();
  });
});
