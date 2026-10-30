/** One cell of the contact sheet: what its run starts from, and where it sits on the grid. */
export type SheetCell =
  | { readonly kind: 'galaxy'; readonly galaxy: string; readonly label: string; readonly row: number; readonly column: number }
  | { readonly kind: 'daily'; readonly date: string; readonly label: string; readonly row: number; readonly column: number };

export const SHEET_COLUMNS: number;
/** Every galaxy id, Dimension by Dimension: `1-1` … `5-6`. */
export const GALAXY_IDS: readonly string[];
/** The Dailies the sheet shows, each on its own date. */
export const DAILY_DATES: readonly string[];
/** Where each cell sits: the galaxies row by row, the Dailies on the row after. */
export function sheetCells(galaxyIds?: readonly string[], dailyDates?: readonly string[], columns?: number): SheetCell[];
