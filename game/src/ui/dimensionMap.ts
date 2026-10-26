import { DIMENSION_NUMBERS, DIMENSIONS, GALAXY_INDEXES, galaxyIdOf } from '../content/galaxies';
import type { Dimension, GalaxyIndex } from '../content/types';
import { dimensionStars, isUnlocked } from '../meta/progress';
import type { SaveData } from '../meta/save';
import { button, element, lockIcon, menuCard, spokenGalaxy, withTestId, type Act, type MenuCard } from './dom';

const STARS_PER_DIMENSION = 3 * GALAXY_INDEXES.length;

export interface DimensionMap extends MenuCard {
  update(save: SaveData): void;
}

interface DimensionCard {
  readonly d: Dimension;
  readonly el: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly status: HTMLElement;
  /** One pip per galaxy, lit once it is cleared. */
  readonly pips: readonly { readonly g: GalaxyIndex; readonly el: HTMLElement }[];
}

function dimensionCard(d: Dimension, act: Act): DimensionCard {
  const el = withTestId(button('dimension-card', '', act({ kind: 'openDimension', dimension: d })), `dimension-${String(d)}`);
  // The CSS gives each Dimension its own accent hue from this.
  el.dataset['dimension'] = String(d);
  const orb = element('span', 'dimension-card__orb');
  orb.setAttribute('aria-hidden', 'true');
  orb.append(lockIcon());
  const name = element('span', 'dimension-card__name');
  const status = element('span', 'dimension-card__status');
  const pipRow = element('span', 'pips');
  pipRow.setAttribute('aria-hidden', 'true');
  const pips = GALAXY_INDEXES.map((g) => ({ g, el: element('span', g === 6 ? 'pip pip--boss' : 'pip') }));
  pipRow.append(...pips.map(({ el: pip }) => pip));
  el.append(orb, element('span', 'dimension-card__index', `D${String(d)}`), name, status, pipRow);
  return { d, el, name, status, pips };
}

/**
 * The Dimension map: five cards in a row (a list on narrow screens), each with its name, stars won out of 18 and a
 * pip per galaxy cleared. A locked one is a dim silhouette that says what opens it, and cannot take focus.
 */
export function createDimensionMap(act: Act): DimensionMap {
  const total = element('p', 'label');
  const row = element('div', 'dimension-row');
  const cards = DIMENSION_NUMBERS.map((d) => dimensionCard(d, act));
  row.append(...cards.map(({ el }) => el));
  return {
    ...menuCard('map', 'Dimensions', total, row),
    update(save) {
      let won = 0;
      for (const { d, el, name, status, pips } of cards) {
        const open = isUnlocked(save, galaxyIdOf(d, 1));
        const stars = dimensionStars(save, d);
        won += stars;
        el.disabled = !open;
        el.classList.toggle('is-locked', !open);
        name.textContent = open ? DIMENSIONS[d] : '';
        status.textContent = open ? `★ ${String(stars)}/${String(STARS_PER_DIMENSION)}` : `Clear ${String(d - 1)}-★ to unlock`;
        el.setAttribute(
          'aria-label',
          open ? `Dimension ${String(d)}, ${DIMENSIONS[d]}, ${String(stars)} of ${String(STARS_PER_DIMENSION)} stars` : `Dimension ${String(d)}, locked; clear the ${spokenGalaxy(galaxyIdOf((d - 1) as Dimension, 6))} to unlock`,
        );
        for (const { g, el: pip } of pips) pip.classList.toggle('pip--lit', (save.galaxies[galaxyIdOf(d, g)]?.stars ?? 0) > 0);
      }
      total.textContent = `★ ${String(won)}/${String(STARS_PER_DIMENSION * DIMENSION_NUMBERS.length)}`;
    },
  };
}
