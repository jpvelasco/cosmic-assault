import { DIMENSIONS, GALAXY_INDEXES, galaxyIdOf, galaxyLabel } from '../content/galaxies';
import type { Dimension, GalaxyId, GalaxyIndex } from '../content/types';
import { isUnlocked } from '../meta/progress';
import type { SaveData } from '../meta/save';
import { button, element, lockIcon, menuCard, starRow, withTestId, type Act, type MenuCard, type StarRow } from './dom';

export interface GalaxySelect extends MenuCard {
  update(dimension: Dimension, save: SaveData): void;
}

interface Tile {
  readonly g: GalaxyIndex;
  readonly el: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly stars: StarRow;
  readonly best: HTMLElement;
}

const BOSS_INDEX: GalaxyIndex = 6;

const starsText = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(3 - stars);

/**
 * Galaxy select: six tiles (`d-1` to `d-★`, the boss tile in gold), each with its stars and best score. The tiles are
 * made once and re-aimed at the open Dimension, so a focused tile keeps focus. A locked tile shows a padlock, says what
 * opens it, and cannot take focus.
 */
export function createGalaxySelect(act: Act): GalaxySelect {
  let dimension: Dimension = 1;
  const grid = element('div', 'galaxy-grid');
  const tiles: Tile[] = GALAXY_INDEXES.map((g) => {
    const el = button(g === BOSS_INDEX ? 'galaxy-tile galaxy-tile--boss' : 'galaxy-tile', '', () => {
      act({ kind: 'openGalaxy', id: galaxyIdOf(dimension, g) })();
    });
    const label = element('span', 'galaxy-tile__label');
    const stars = starRow('galaxy-tile__stars');
    const best = element('span', 'galaxy-tile__best');
    el.append(lockIcon(), label, stars.el, best);
    if (g === BOSS_INDEX) el.append(element('span', 'galaxy-tile__tag', 'Boss'));
    return { g, el, label, stars, best };
  });
  grid.append(...tiles.map(({ el }) => el));
  const select = menuCard('galaxies', '', grid);

  function setTile({ el, label, stars, best }: Tile, id: GalaxyId, save: SaveData): void {
    const open = isUnlocked(save, id);
    const progress = save.galaxies[id];
    withTestId(el, `galaxy-${id}`);
    el.disabled = !open;
    el.classList.toggle('is-locked', !open);
    label.textContent = galaxyLabel(id);
    stars.set(progress?.stars ?? 0);
    best.textContent = !open ? 'Clear the previous galaxy' : progress === undefined ? 'Not cleared yet' : `Best ${String(progress.bestScore)}`;
    el.setAttribute('aria-label', open ? `${galaxyLabel(id)} ${starsText(progress?.stars ?? 0)} ${String(progress?.bestScore ?? 0)}` : `${galaxyLabel(id)} · Clear the previous galaxy`);
  }

  return {
    ...select,
    update(next, save) {
      dimension = next;
      select.title.textContent = `D${String(next)} · ${DIMENSIONS[next]}`;
      select.card.dataset['dimension'] = String(next);
      for (const tile of tiles) setTile(tile, galaxyIdOf(next, tile.g), save);
    },
  };
}
