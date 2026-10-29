import { describe, expect, it } from 'vitest';
import { DAILY_TWISTS, TWISTS_BY_ID } from '../../src/content/daily';
import { dailyGalaxy } from '../../src/meta/dailyGalaxy';
import { defaultSave, type SaveData } from '../../src/meta/save';
import * as copy from '../../src/ui/dailyCopy';
import { dailyCardView } from '../../src/ui/modeSelect';
import { dailyRecordLines } from '../../src/ui/recordsCard';
import { PRESSURE } from '../helpers/pressure';

/** Every line of `ui/dailyCopy.ts`, rendered: the record type makes a new export fail to compile until it is listed here. */
const RENDERED: Readonly<Record<keyof typeof copy, readonly string[]>> = {
  DAILY_NAME: [copy.DAILY_NAME],
  DAILY_LABEL: [copy.DAILY_LABEL],
  DAILY_BADGE: [copy.DAILY_BADGE],
  dailyTitle: [copy.dailyTitle('2026-10-26')],
  DAILY_CLEARED: [copy.DAILY_CLEARED],
  targetText: [copy.targetText(14500)],
  dailyCardLine: DAILY_TWISTS.map((twist) => copy.dailyCardLine(twist.name, 14500)),
  streakText: [copy.streakText(2), copy.streakText(30)],
  bestStreakText: [copy.bestStreakText(1), copy.bestStreakText(12)],
  twistToast: DAILY_TWISTS.map((twist) => copy.twistToast(twist.name)),
  targetLine: [copy.targetLine(14500, 14499), copy.targetLine(14500, 14500), copy.targetLine(14500, 0)],
  dailyBestText: [copy.dailyBestText({ date: '2026-10-26', score: 12345 })],
  NO_DAILY_YET: [copy.NO_DAILY_YET],
  DAILY_UNAVAILABLE: [copy.DAILY_UNAVAILABLE],
};

describe('the Daily copy', () => {
  const lines = [...Object.values(RENDERED).flat(), ...DAILY_TWISTS.flatMap((twist) => [twist.name, twist.blurb])];

  it.each(lines)('never presses or speaks of loss: %j', (line) => {
    expect(line).not.toMatch(PRESSURE);
    expect(line.trim()).not.toBe('');
  });

  it('the guard catches the words it is there for', () => {
    for (const line of ["Don't lose your streak", 'Don’t go', 'Last chance!', 'It expires at midnight', 'Play before it’s gone', "before it's gone", 'Missed a day', 'Streak broken', 'Hurry'])
      expect(line, line).toMatch(PRESSURE);
  });

  it('reads as the cards show it', () => {
    expect(copy.dailyTitle('2026-10-26')).toBe('Daily Galaxy · 2026-10-26');
    expect(copy.dailyCardLine('Gravity storm', 14500)).toBe('Gravity storm · Target\u00a014,500');
    expect(copy.twistToast('Gravity storm')).toBe("Today's twist: Gravity storm");
    expect(copy.streakText(3)).toBe('Streak 3');
    expect(copy.dailyBestText({ date: '2026-10-26', score: 12345 })).toBe('Best on 2026-10-26: 12,345');
  });

  it('marks the target beaten once the score reaches it', () => {
    expect(copy.targetLine(14500, 14499)).toBe('Target\u00a014,500');
    expect(copy.targetLine(14500, 14500)).toBe('Target\u00a014,500 · beaten');
    expect(copy.targetLine(14500, 20000)).toBe('Target\u00a014,500 · beaten');
  });

  it('keeps the target on one line with its number, which never wraps alone', () => {
    expect(copy.targetText(14500)).toBe('Target\u00a014,500');
    expect(copy.targetText(14500)).not.toMatch(/ /);
  });
});

const TODAY = '2026-10-26';
const withDaily = (daily: Partial<SaveData['daily']>): SaveData => ({ ...defaultSave(), daily: { ...defaultSave().daily, ...daily } });

describe('the Daily mode card', () => {
  it("names today's twist, its blurb and its target", () => {
    const { twist, target } = dailyGalaxy(TODAY);
    const { line, blurb } = dailyCardView(defaultSave(), TODAY);
    expect(line).toBe(copy.dailyCardLine(TWISTS_BY_ID[twist].name, target));
    expect(blurb).toBe(TWISTS_BY_ID[twist].blurb);
  });

  it('shows the streak from 2, while it runs from yesterday or today', () => {
    expect(dailyCardView(withDaily({ lastCleared: '2026-10-25', streak: 1, bestStreak: 1 }), TODAY).streak).toBe('');
    expect(dailyCardView(withDaily({ lastCleared: '2026-10-25', streak: 2, bestStreak: 2 }), TODAY).streak).toBe('Streak 2');
    expect(dailyCardView(withDaily({ lastCleared: TODAY, streak: 5, bestStreak: 5 }), TODAY).streak).toBe('Streak 5');
    expect(dailyCardView(withDaily({ lastCleared: '2026-10-20', streak: 5, bestStreak: 5 }), TODAY).streak).toBe('');
  });

  it('can be played, with no problem to log, on a date the generator builds', () => {
    expect(dailyCardView(defaultSave(), TODAY).problem).toBeNull();
  });

  it('shows the Daily as unavailable when the generator throws, naming the date and the fault in the problem it logs', () => {
    const fails = (date: string) => ({ daily: null, error: new Error(`no anchor for ${date}`) });
    const view = dailyCardView(withDaily({ lastCleared: TODAY, streak: 5, bestStreak: 5 }), TODAY, fails);
    expect(view).toMatchObject({ line: copy.DAILY_UNAVAILABLE, blurb: '', streak: '' });
    expect(view.problem).toContain(TODAY);
    expect(view.problem).toContain(`no anchor for ${TODAY}`);
    expect(view.problem).toMatch(/Rank and Free play/);
  });
});

describe('the records card Daily block', () => {
  it('welcomes a player who has cleared no Daily yet', () => {
    expect(dailyRecordLines(defaultSave(), TODAY)).toEqual([copy.NO_DAILY_YET]);
  });

  it('shows the running streak, the best streak and the latest date\'s best', () => {
    const save = withDaily({ lastCleared: '2026-10-25', streak: 3, bestStreak: 7, best: { date: '2026-10-25', score: 12345 } });
    expect(dailyRecordLines(save, TODAY)).toEqual(['Streak 3', 'Best streak 7', 'Best on 2026-10-25: 12,345']);
  });

  it('leaves the streak out once it no longer runs, keeping the best streak and best', () => {
    const save = withDaily({ lastCleared: '2026-10-01', streak: 3, bestStreak: 7, best: { date: '2026-10-01', score: 900 } });
    expect(dailyRecordLines(save, TODAY)).toEqual(['Best streak 7', 'Best on 2026-10-01: 900']);
  });
});
