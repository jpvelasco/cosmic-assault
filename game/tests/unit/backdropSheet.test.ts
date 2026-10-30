import { describe, expect, it } from 'vitest';
import { GALAXIES } from '../../src/content/galaxies';
import { dailyGalaxy } from '../../src/meta/dailyGalaxy';
import { DAILY_DATES, GALAXY_IDS, SHEET_COLUMNS, sheetCells } from '../../scripts/backdrop-sheet.mjs';

const at = (row: number, column: number) => sheetCells().find((cell) => cell.row === row && cell.column === column);

describe('the contact sheet', () => {
  it('shows every galaxy, Dimension by Dimension', () => {
    expect([...GALAXY_IDS]).toEqual(GALAXIES.map(({ id }) => id));
  });

  it('lays the galaxies out six to a row, one Dimension a row, and the Dailies on a last row', () => {
    expect(SHEET_COLUMNS).toBe(6);
    const cells = sheetCells();
    expect(cells).toHaveLength(GALAXIES.length + DAILY_DATES.length);
    expect(new Set(cells.map(({ row, column }) => `${String(row)},${String(column)}`)).size).toBe(cells.length);
    expect(at(0, 0)).toMatchObject({ kind: 'galaxy', galaxy: '1-1', label: '1-1' });
    expect(at(0, 5)).toMatchObject({ kind: 'galaxy', galaxy: '1-6', label: '1-6' });
    expect(at(4, 5)).toMatchObject({ kind: 'galaxy', galaxy: '5-6', label: '5-6' });
    expect(Math.max(...cells.map(({ row }) => row)) + 1).toBe(6);
    expect(cells.filter(({ row }) => row === 5).map(({ column }) => column)).toEqual([0, 1]);
  });

  it('captions each Daily with its date', () => {
    expect(at(5, 0)).toMatchObject({ kind: 'daily', date: DAILY_DATES[0], label: `Daily ${String(DAILY_DATES[0])}` });
    expect(at(5, 1)).toMatchObject({ kind: 'daily', date: DAILY_DATES[1], label: `Daily ${String(DAILY_DATES[1])}` });
  });

  it('shows only Dailies that build', () => {
    for (const date of DAILY_DATES) expect(() => dailyGalaxy(date), date).not.toThrow();
  });
});
