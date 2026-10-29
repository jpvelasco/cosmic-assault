import { describe, expect, it, vi } from 'vitest';
import { COVER_CARD_IDS, COVER_CARD_SCREENS, createCardToggle, createCoverCards, type CoverCardId } from '../../src/app/cardToggle';
import type { Screen } from '../../src/app/flow';

const fakeCard = () => ({ show: vi.fn(), hide: vi.fn(), cover: vi.fn(), controls: vi.fn(() => []) });

function toggleOn(id: CoverCardId, screen: Screen) {
  const card = fakeCard();
  let ownClose = (): void => undefined;
  const deps = { screen: () => screen, syncView: vi.fn(), focusOpener: vi.fn() };
  const toggle = createCardToggle(
    id,
    (close) => {
      ownClose = close;
      return card;
    },
    deps,
  );
  return {
    toggle,
    card,
    deps,
    ownClose: () => {
      ownClose();
    },
  };
}

describe('the cover card table', () => {
  it('lists every cover card bottom first, each with the screens its chip is on', () => {
    expect(COVER_CARD_IDS).toEqual(['settings', 'records', 'hangar']);
    expect(COVER_CARD_SCREENS).toEqual({ settings: ['title', 'modeSelect', 'paused'], records: ['title', 'modeSelect'], hangar: ['title', 'modeSelect'] });
  });
});

describe('a cover card toggle', () => {
  it.each(['title', 'modeSelect', 'paused'] as const)('opens the settings card on %s, where its chip is', (screen) => {
    const { toggle, card } = toggleOn('settings', screen);
    toggle.show();
    expect(toggle.open).toBe(true);
    expect(card.show).toHaveBeenCalledOnce();
  });

  it.each<[CoverCardId, Screen]>([
    ['settings', 'playing'],
    ['settings', 'map'],
    ['settings', 'results'],
    ['records', 'paused'],
    ['hangar', 'paused'],
    ['records', 'galaxySelect'],
  ])('keeps the %s card shut on %s, which has no chip for it', (id, screen) => {
    const { toggle, card } = toggleOn(id, screen);
    toggle.show();
    expect(toggle.open).toBe(false);
    expect(card.show).not.toHaveBeenCalled();
  });

  it('closes back to the card that opened it, focus on its chip, by its own Back as by the toggle', () => {
    const { toggle, card, deps, ownClose } = toggleOn('records', 'modeSelect');
    toggle.show();
    toggle.close();
    expect(toggle.open).toBe(false);
    expect(card.hide).toHaveBeenCalledOnce();
    expect(deps.focusOpener).toHaveBeenCalledOnce();
    toggle.show();
    ownClose();
    expect(toggle.open).toBe(false);
    expect(card.hide).toHaveBeenCalledTimes(2);
  });

  it('does nothing when closed while shut', () => {
    const { toggle, card, deps } = toggleOn('hangar', 'title');
    toggle.close();
    expect(card.hide).not.toHaveBeenCalled();
    expect(deps.focusOpener).not.toHaveBeenCalled();
  });
});

describe('createCoverCards', () => {
  function table() {
    const settings = toggleOn('settings', 'title');
    const records = toggleOn('records', 'title');
    const hangar = toggleOn('hangar', 'title');
    return { cards: createCoverCards({ settings: settings.toggle, records: records.toggle, hangar: hangar.toggle }), settings, records, hangar };
  }

  it('has no top card while none is up, and closing then does nothing', () => {
    const { cards, settings } = table();
    expect(cards.top()).toBeNull();
    cards.closeTop();
    expect(settings.card.hide).not.toHaveBeenCalled();
  });

  it('names the card that is up and closes it, one card per close', () => {
    const { cards, records, settings } = table();
    records.toggle.show();
    expect(cards.isOpen('records')).toBe(true);
    expect(cards.isOpen('settings')).toBe(false);
    expect(cards.top()).toBe(records.toggle);
    cards.closeTop();
    expect(records.toggle.open).toBe(false);
    expect(cards.top()).toBeNull();
    cards.closeTop();
    expect(records.card.hide).toHaveBeenCalledOnce();
    expect(settings.card.hide).not.toHaveBeenCalled();
  });

  it('closes the topmost first when more than one is up', () => {
    const { cards, settings, hangar } = table();
    settings.toggle.show();
    hangar.toggle.show();
    cards.closeTop();
    expect(hangar.toggle.open).toBe(false);
    expect(settings.toggle.open).toBe(true);
    expect(cards.top()).toBe(settings.toggle);
  });

  it('covers every card for the rotate prompt', () => {
    const { cards, settings, records, hangar } = table();
    cards.cover(true);
    for (const { card } of [settings, records, hangar]) expect(card.cover).toHaveBeenCalledWith(true);
  });
});
