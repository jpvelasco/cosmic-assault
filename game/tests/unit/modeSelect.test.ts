import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TWISTS_BY_ID } from '../../src/content/daily';
import { tryDailyGalaxy, type DailyOutcome } from '../../src/meta/dailyGalaxy';
import { defaultSave } from '../../src/meta/save';
import { RingLog } from '../../src/platform/log';
import { DAILY_UNAVAILABLE, dailyCardLine } from '../../src/ui/dailyCopy';
import { createModeSelect } from '../../src/ui/modeSelect';
import { asFake, stubDocument, type FakeElement } from '../helpers/fakeDom';

const BROKEN = '2026-10-26';
const FINE = '2026-10-27';

/** The generator, but failing on BROKEN. */
const build = (date: string): DailyOutcome => (date === BROKEN ? { daily: null, error: new Error(`no anchor for ${date}`) } : tryDailyGalaxy(date));

describe('mode select on a date whose Daily cannot be built', () => {
  beforeEach(stubDocument);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function modes() {
    const log = new RingLog();
    const select = createModeSelect(() => () => undefined, log, build);
    const daily = asFake(select.modeSelect.panel).byTestId('mode-daily');
    if (daily === null) throw new Error('mode select has no Daily card');
    const line = (card: FakeElement): string => card.children.find((child) => child.className === 'mode-card__text')?.textContent ?? '';
    return { select, log, daily, line: () => line(daily) };
  }

  it('shows the Daily card unavailable, and logs why once for the date however often it shows', () => {
    const { select, log, daily, line } = modes();
    select.update(defaultSave(), BROKEN);
    expect(daily.disabled).toBe(true);
    expect(line()).toBe(DAILY_UNAVAILABLE);
    // A new save redraws the card, so only the guard keeps the date from being logged again.
    select.update(defaultSave(), BROKEN);
    expect(daily.disabled).toBe(true);
    expect(log.entries()).toEqual([expect.objectContaining({ kind: 'error', message: expect.stringContaining(`no anchor for ${BROKEN}`) as string })]);
  });

  it('offers the Daily again on a later date that builds, logging nothing for it', () => {
    const { select, log, daily, line } = modes();
    select.update(defaultSave(), BROKEN);
    select.update(defaultSave(), FINE);
    expect(daily.disabled).toBe(false);
    const fine = tryDailyGalaxy(FINE).daily;
    if (fine === null) throw new Error(`the Daily of ${FINE} should build`);
    expect(line()).toBe(dailyCardLine(TWISTS_BY_ID[fine.twist].name, fine.target));
    expect(log.entries()).toHaveLength(1);
  });
});
