import type { Palette } from '../render/palette';

/** Sets the page's `--accent-1` to `--accent-3` (the cards' gradient, glow and buttons) from `palette`, so the menus match the sky behind them. */
export function applyAccents(style: Pick<CSSStyleDeclaration, 'setProperty'>, palette: Palette): void {
  palette.accent.forEach((color, i) => {
    style.setProperty(`--accent-${String(i + 1)}`, color);
  });
}
