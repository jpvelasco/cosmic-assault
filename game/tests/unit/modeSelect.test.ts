import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TWISTS_BY_ID } from '../../src/content/daily';
import type { Command } from '../../src/app/commands';
import { tryDailyGalaxy, type DailyOutcome } from '../../src/meta/dailyGalaxy';
import { defaultSave } from '../../src/meta/save';
import { RingLog } from '../../src/platform/log';
import { DAILY_UNAVAILABLE, dailyCardLine } from '../../src/ui/dailyCopy';
import { createModeSelect } from '../../src/ui/modeSelect';
import { asFake, stubDocument } from '../helpers/fakeDom';

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
    const line = (): string => daily.children.find((child) => child.className === 'mode-card__text')?.textContent ?? '';
    return { select, log, daily, line };
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

describe('the Daily card across midnight', () => {
  beforeEach(stubDocument);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a press sends the date the card shows, so a card left showing an earlier day is redrawn before anything plays', () => {
    const sent: Command[] = [];
    const select = createModeSelect((command) => () => sent.push(command), new RingLog(), build);
    const daily = asFake(select.modeSelect.panel).byTestId('mode-daily');
    if (daily === null) throw new Error('mode select has no Daily card');
    select.update(defaultSave(), FINE);
    daily.click();
    const later = '2026-10-28';
    select.update(defaultSave(), later);
    daily.click();
    expect(sent).toEqual([
      { kind: 'chooseMode', mode: 'daily', date: FINE },
      { kind: 'chooseMode', mode: 'daily', date: later },
    ]);
  });
});
