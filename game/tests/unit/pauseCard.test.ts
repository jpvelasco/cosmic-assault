import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hintCopy, hintVariants } from '../../src/ui/hints';
import { createPauseCard, pressQuit, quitLabel } from '../../src/ui/pauseCard';
import { asFake, stubDocument, type FakeElement } from '../helpers/fakeDom';

describe('the pause card Quit', () => {
  it('asks twice in Rank, where it costs a life, and once in Free play and the Daily', () => {
    expect(pressQuit('rank', 'ready')).toBe('arm');
    expect(pressQuit('rank', 'armed')).toBe('quit');
    for (const mode of ['free', 'daily'] as const) expect(pressQuit(mode, 'ready')).toBe('quit');
  });

  it('says where it goes, and in Rank what it costs', () => {
    expect(quitLabel('free', 'ready')).toBe('Quit to title');
    expect(quitLabel('daily', 'ready')).toBe('Quit to title');
    expect(quitLabel('rank', 'ready')).toBe('Quit (costs a life)');
    expect(quitLabel('rank', 'armed')).toBe('Really quit? Costs a life');
  });
});

describe('createPauseCard', () => {
  beforeEach(stubDocument);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function pauseCard() {
    const actions = { resume: vi.fn(), quit: vi.fn() };
    const card = createPauseCard(actions, document.createElement('div'));
    const byTestId = (id: string) => {
      const el = asFake(card.panel).byTestId(id);
      if (el === null) throw new Error(`the pause card has no ${id}`);
      return el;
    };
    return { card, actions, quit: byTestId('quit'), resume: byTestId('resume'), hint: byTestId('pause-hint') };
  }

  it('quits in Rank on the second press only, and a disarm puts the first label back', () => {
    const { card, actions, quit } = pauseCard();
    card.update('rank', hintCopy('keys'));
    expect(quit.textContent).toBe('Quit (costs a life)');

    quit.click();
    expect(actions.quit).not.toHaveBeenCalled();
    expect(quit.textContent).toBe('Really quit? Costs a life');
    expect(card.disarm()).toBe(true);
    expect(quit.textContent).toBe('Quit (costs a life)');
    expect(card.disarm()).toBe(false);

    quit.click();
    quit.click();
    expect(actions.quit).toHaveBeenCalledOnce();
  });

  it('quits in Free play on the first press', () => {
    const { card, actions, quit } = pauseCard();
    card.update('free', hintCopy('keys'));
    expect(quit.textContent).toBe('Quit to title');
    quit.click();
    expect(actions.quit).toHaveBeenCalledOnce();
    expect(card.disarm()).toBe(false);
  });

  it('names Esc beside Resume and the keys under the buttons for keys, and nothing for touch', () => {
    const { card, resume, hint } = pauseCard();
    const key = resume.children[0];
    card.update('free', hintCopy('keys'));
    expect(key?.textContent).toBe('Esc');
    expect(key?.hidden).toBe(false);
    expect(hint.textContent).toBe('Esc or P to resume');
    expect(hint.hidden).toBe(false);

    card.update('free', hintCopy('touch'));
    expect(key?.hidden).toBe(true);
    expect(hint.hidden).toBe(true);
  });

  it('keeps the space of the longest wording of its key line in any style, so the input kind never moves its buttons', () => {
    const { card, hint } = pauseCard();
    const holder = (el: FakeElement): FakeElement | null => (el.children.includes(hint) ? el : el.children.map(holder).find((found) => found !== null) ?? null);
    const wrap = holder(asFake(card.panel));
    const copies = wrap?.children.filter((child) => child !== hint).map((child) => child.dataset['text']);
    expect(copies).toEqual(hintVariants((hints) => hints.paused).filter((text) => text !== ''));
    expect(wrap?.className).toBe('reserve');
  });
});
