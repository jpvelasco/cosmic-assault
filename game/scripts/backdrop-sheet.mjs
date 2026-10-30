// Renders a contact sheet of every galaxy's sky, and of two Dailies, for review before the look ships. The sheet is not
// committed: it goes to --out (game/backdrop-sheet/ by default, which git ignores).
// Usage: npm run backdrop-sheet -- [--skip-build] [--out <dir>]
//
// It builds dist-e2e/ (unless --skip-build), serves it, and for each cell stages the galaxy through the e2e URL overrides
// (or the Daily through its date and the title's Play), waits for its first frames, and shoots the canvas alone. Two
// sheets come out: backdrop-sheet-desktop.png (16:9) and backdrop-sheet-phone.png (a Pixel 5 in landscape). Each cell is
// captioned with its id, or the Daily's date, and the set-piece its sky draws.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { contextOptions, e2eQuery, GAME_DIR, startRunFromTitle, waitForBridge, waitForPlaying, withE2eBrowser } from './staging.mjs';

/** Galaxies per row: a Dimension's six galaxies fill one row. */
export const SHEET_COLUMNS = 6;
/** Each cell's width on the sheet, in CSS px. */
const CELL_WIDTH = 400;

/** Every galaxy id, Dimension by Dimension: `1-1` … `5-6`. */
export const GALAXY_IDS = Array.from({ length: 5 }, (_, dimension) => Array.from({ length: 6 }, (_, galaxy) => `${String(dimension + 1)}-${String(galaxy + 1)}`)).flat();

/** Two Dailies, each on its own date, which the sheet shows on a last row. */
export const DAILY_DATES = ['2026-10-30', '2026-11-02'];

/**
 * Where each cell sits: the galaxies fill the grid row by row, and the Dailies start the next row. `kind` says how the
 * run starts (`galaxy` at `?galaxy=`, `daily` at `?today=` and the title's Play), `label` is the caption's first part.
 */
export function sheetCells(galaxyIds = GALAXY_IDS, dailyDates = DAILY_DATES, columns = SHEET_COLUMNS) {
  const dailyStart = Math.ceil(galaxyIds.length / columns) * columns;
  const galaxies = galaxyIds.map((galaxy, index) => ({ kind: 'galaxy', galaxy, label: galaxy, index }));
  const dailies = dailyDates.map((date, offset) => ({ kind: 'daily', date, label: `Daily ${date}`, index: dailyStart + offset }));
  return [...galaxies, ...dailies].map(({ index, ...cell }) => ({ ...cell, row: Math.floor(index / columns), column: index % columns }));
}

/** The two sheets: a file's name suffix and the device each cell is shot on. */
const SHEETS = [
  { name: 'desktop', device: 'desktop' },
  { name: 'phone', device: 'phone' },
];

/** The e2e query that stages `cell`: its galaxy's, or its Daily's date. */
function queryOf(cell) {
  return cell.kind === 'daily' ? e2eQuery({ today: cell.date }) : e2eQuery({ galaxy: cell.galaxy });
}

/** Starts a Daily from the title: Play, then the Daily card, by a click or a tap on a phone. */
async function startDailyFromTitle(page, press) {
  await page.getByTestId('play')[press]();
  await page.getByTestId('mode-daily')[press]();
  await waitForPlaying(page);
}

/** Hides every page element but the game's canvas, so the capture is the sky with its ship and field and nothing over them. */
function showCanvasOnly(page) {
  return page.evaluate(() => {
    document.body.style.visibility = 'hidden';
    const canvas = document.querySelector('#game');
    if (canvas instanceof HTMLElement) canvas.style.visibility = 'visible';
  });
}

/** Resolves after two animation frames, so the first frames of the run have been drawn. */
function twoFrames(page) {
  return page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))));
}

/** Shoots `cell` on `device`: its PNG and the set-piece its sky draws. */
async function shootCell(browser, devices, url, device, cell) {
  const context = await browser.newContext(contextOptions(device, devices));
  try {
    const page = await context.newPage();
    await page.goto(`${url}?${queryOf(cell)}`);
    await waitForBridge(page);
    if (cell.kind === 'daily') await startDailyFromTitle(page, device === 'phone' ? 'tap' : 'click');
    else await startRunFromTitle(page);
    await twoFrames(page);
    const piece = await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__?.getState().backdrop.piece ?? 'unknown');
    await showCanvasOnly(page);
    const png = await page.locator('#game').screenshot({ type: 'png' });
    return { png, piece };
  } catch (error) {
    throw new Error(`${cell.label} on ${device} did not shoot: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    await context.close();
  }
}

/** The sheet's page: a grid of captioned captures, each image drawn `CELL_WIDTH` CSS px wide. */
function sheetHtml(shots) {
  const cells = shots
    .map(({ cell, png, piece }) => `<figure style="grid-row:${String(cell.row + 1)};grid-column:${String(cell.column + 1)}"><img src="data:image/png;base64,${png.toString('base64')}" alt="${cell.label}"><figcaption>${cell.label} · ${piece}</figcaption></figure>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 12px; background: #000; color: #ddd; font: 14px sans-serif; }
    .grid { display: grid; gap: 10px; grid-template-columns: repeat(${String(SHEET_COLUMNS)}, ${String(CELL_WIDTH)}px); }
    figure { margin: 0; }
    img { display: block; width: ${String(CELL_WIDTH)}px; height: auto; }
    figcaption { padding: 3px 0 6px; }
  </style><div class="grid">${cells}</div>`;
}

/** The sheet's PNG: `shots` laid out as sheetHtml draws them, screenshot whole. */
async function composeSheet(browser, shots) {
  const page = await browser.newPage();
  try {
    await page.setContent(sheetHtml(shots));
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await page.close();
  }
}

/** Shoots every cell on `device` and writes that device's sheet to `outDir`. */
async function renderSheet(browser, devices, url, { name, device }, outDir) {
  const shots = [];
  for (const cell of sheetCells()) shots.push({ cell, ...(await shootCell(browser, devices, url, device, cell)) });
  const path = join(outDir, `backdrop-sheet-${name}.png`);
  await writeFile(path, await composeSheet(browser, shots));
  console.log(path);
}

async function main() {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false }, out: { type: 'string' } } });
  const outDir = resolve(values.out ?? join(GAME_DIR, 'backdrop-sheet'));
  await withE2eBrowser({ skipBuild: values['skip-build'] }, async ({ browser, devices, url }) => {
    await mkdir(outDir, { recursive: true });
    for (const sheet of SHEETS) await renderSheet(browser, devices, url, sheet, outDir);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
