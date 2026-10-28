import { SKIN_IDS, SKINS, TRAIL_IDS, TRAILS, type Look, type SkinId, type TrailId } from '../content/cosmetics';
import { ALL_STARS } from '../content/galaxies';
import { effectiveLook, totalStars, unlockedLooks } from '../meta/cosmetics';
import type { SaveData } from '../meta/save';
import { get2dContext } from '../render/context';
import { createFieldPen } from '../render/fieldPen';
import { DRIFT } from '../render/palette';
import { createSpriteBaker, type Sprite } from '../render/sprites';
import type { Settings } from '../app/settings';
import { createCoverCard, type CoverCard } from './coverCard';
import { button, element, PRIMARY_BUTTON, withTestId } from './dom';

export interface HangarCardActions {
  /** A choice was picked: write it now. */
  readonly choose: (patch: Partial<Pick<Settings, 'skin' | 'trail'>>) => void;
  /** Back, Esc or pad B. */
  readonly back: () => void;
}

export interface HangarCard extends CoverCard {
  /** Brings the groups, the preview and the star count in line with the save and the chosen look. */
  update(save: SaveData, look: Pick<Settings, 'skin' | 'trail'>): void;
}

/** One choice in a group, as the card shows it. */
export interface HangarChoice<T extends string> {
  readonly id: T;
  readonly name: string;
  readonly stars: number;
  readonly locked: boolean;
  /** Whether this is the look drawn. */
  readonly checked: boolean;
}

/** The choices of one group in list order: each look with its cost, whether it is locked, and whether it is drawn. */
export function hangarChoices<T extends string>(
  ids: readonly T[],
  specs: Readonly<Record<T, { readonly name: string; readonly stars: number }>>,
  unlocked: readonly T[],
  drawn: T,
): HangarChoice<T>[] {
  return ids.map((id) => ({ id, name: specs[id].name, stars: specs[id].stars, locked: !unlocked.includes(id), checked: id === drawn }));
}

/** The star cost a locked choice shows; an unlocked one shows none. */
export function lockedCost({ stars, locked }: Pick<HangarChoice<string>, 'stars' | 'locked'>): string {
  return locked ? `★ ${String(stars)}` : '';
}

/** The preview's size in CSS px, and how many device px a field unit takes in it. */
const PREVIEW_WIDTH = 220;
const PREVIEW_HEIGHT = 110;
const PREVIEW_SCALE = 3;
/** Where the ship sits in the preview, in field units. */
const SHIP_X = (PREVIEW_WIDTH * 0.62) / PREVIEW_SCALE;
const SHIP_Y = PREVIEW_HEIGHT / 2 / PREVIEW_SCALE;
/** The trail's dots: how far behind the ship each sits, in field units, and how far apart. */
const TRAIL_DOTS = 6;
const TRAIL_FIRST_UNITS = 12;
const TRAIL_STEP_UNITS = 6;
const TRAIL_GLOW_UNITS = 10;

interface Preview {
  readonly canvas: HTMLCanvasElement;
  draw(look: Look): void;
}

/** The ship with its trim, and a still trail behind it. It is drawn only when the look changes, never per frame. */
function createPreview(): Preview {
  const canvas = element('canvas', 'hangar-preview');
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  canvas.setAttribute('role', 'img');
  const ctx = get2dContext(canvas);
  const pen = createFieldPen(ctx);
  pen.aim(PREVIEW_SCALE, 0, 0);
  const baker = createSpriteBaker();
  baker.setScale(PREVIEW_SCALE, 1);
  let shown = '';

  const place = (sprite: Sprite, x: number, y: number): void => {
    pen.place(x, y, 1, 0);
    pen.blit(sprite);
  };

  return {
    canvas,
    draw(look) {
      const key = `${look.skin}|${look.trail}`;
      if (key === shown) return;
      shown = key;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      const trail = TRAILS[look.trail];
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < TRAIL_DOTS; i++) {
        const color = trail.coreShare > 0 && i % 2 === 0 ? trail.core : trail.colors[i % trail.colors.length] ?? trail.core;
        ctx.globalAlpha = 1 - i / (TRAIL_DOTS + 1);
        const wobble = i % 2 === 0 ? -1 : 1;
        place(baker.glow(color, TRAIL_GLOW_UNITS), SHIP_X - (TRAIL_FIRST_UNITS + i * TRAIL_STEP_UNITS), SHIP_Y + wobble);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      place(baker.ship(DRIFT, look.skin), SHIP_X, SHIP_Y);
    },
  };
}

interface ChoiceGroup<T extends string> {
  readonly el: HTMLElement;
  set(choices: readonly HangarChoice<T>[]): void;
}

/** A radio group of the choices: a locked one is disabled and says why; picking one reports it through `onPick`. */
function choiceGroup<T extends string>(legend: string, name: string, onPick: (id: T) => void): ChoiceGroup<T> {
  const el = element('fieldset', 'hangar-group');
  el.append(element('legend', 'label', legend));
  const row = element('div', 'segments hangar-group__row');
  const options = new Map<T, { label: HTMLElement; radio: HTMLInputElement; note: HTMLElement; cost: HTMLElement }>();
  el.append(row);
  return {
    el,
    set(choices) {
      for (const choice of choices) {
        let option = options.get(choice.id);
        if (option === undefined) {
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = name;
          radio.value = choice.id;
          radio.dataset['testid'] = `${name}-${choice.id}`;
          radio.addEventListener('change', () => {
            if (radio.checked) onPick(choice.id);
          });
          const label = element('label', 'segment hangar-option');
          const text = element('span', 'hangar-option__name', choice.name);
          // Screen readers hear "Locked" before the cost; the dimmed pill says it to the eye.
          const note = element('span', 'hangar-option__note');
          const cost = element('span', 'hangar-option__cost');
          note.append(element('span', 'visually-hidden', 'Locked · '), cost);
          label.append(radio, text, note);
          row.append(label);
          option = { label, radio, note, cost };
          options.set(choice.id, option);
        }
        option.radio.disabled = choice.locked;
        option.radio.checked = choice.checked;
        option.label.classList.toggle('hangar-option--locked', choice.locked);
        option.cost.textContent = lockedCost(choice);
        option.note.hidden = !choice.locked;
      }
    },
  };
}

/**
 * The Hangar: a cover card over the title or mode select, holding the ship's trim and engine trail. Each look is a
 * radio in its group; a look still locked is disabled and says so, with its star cost. Picking a look writes it at once.
 * Back, Esc and pad B close it; the arrow keys move within a group, which keeps them from moving the menu.
 */
export function createHangarCard(root: HTMLElement, actions: HangarCardActions): HangarCard {
  const cover = createCoverCard(root, 'hangar', 'Hangar', actions.back);
  withTestId(cover.card, 'hangar');
  const preview = createPreview();
  const stars = element('p', 'hint hangar-stars');
  const skins = choiceGroup<SkinId>('Trim', 'hangar-skin', (skin) => {
    actions.choose({ skin });
  });
  const trails = choiceGroup<TrailId>('Engine trail', 'hangar-trail', (trail) => {
    actions.choose({ trail });
  });
  const back = withTestId(button(PRIMARY_BUTTON, 'Back', actions.back), 'hangar-back');
  const head = element('div', 'hangar-head');
  head.append(preview.canvas, stars);
  cover.card.append(head, skins.el, trails.el, back);

  return {
    ...cover,
    update(save, look) {
      const unlocked = unlockedLooks(save);
      const drawn = effectiveLook(look, save);
      skins.set(hangarChoices(SKIN_IDS, SKINS, unlocked.skins, drawn.skin));
      trails.set(hangarChoices(TRAIL_IDS, TRAILS, unlocked.trails, drawn.trail));
      stars.textContent = `Stars won: ${String(totalStars(save))} of ${String(ALL_STARS)}`;
      const label = `Preview: ${SKINS[drawn.skin].name} trim, ${TRAILS[drawn.trail].name} trail`;
      preview.canvas.setAttribute('aria-label', label);
      preview.draw(drawn);
    },
  };
}
