import type { ScreenShake, Settings } from '../app/settings';
import { button, cardPanel, chip, element, keepActivationKeysLocal, showSoundState } from './dom';

export interface SettingsCardActions {
  /** A control moved: apply the change now (sent on every `input` event, so a slider is live while dragged). */
  readonly change: (patch: Partial<Settings>) => void;
  /** A control was let go or chosen (the `change` event): save. */
  readonly save: () => void;
  readonly toggleMute: () => void;
  /** The effects slider was let go: play a sample so the player hears the level they chose. */
  readonly previewSfx: () => void;
  /** Done or Esc. */
  readonly done: () => void;
}

export interface SettingsCard {
  /** Shows the card and moves keyboard focus to the first control. */
  show(): void;
  hide(): void;
  /** Brings every control in line with `settings`. The left-handed choice is offered only where `touchScreen` is true. */
  update(settings: Settings, touchScreen: boolean): void;
  dispose(): void;
}

const SHAKE_CHOICES: readonly { readonly value: ScreenShake; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];
const HEADING_ID = 'settings-heading';

function input(type: 'range' | 'radio' | 'checkbox', onInput: (el: HTMLInputElement) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  el.addEventListener('input', () => {
    onInput(el);
  });
  return el;
}

interface VolumeSlider {
  readonly row: HTMLElement;
  readonly control: HTMLInputElement;
  set(volume: number): void;
}

/** A 0–100 % slider in steps of 5, reporting its volume as 0–1. */
function volumeSlider(label: string, testId: string, onVolume: (volume: number) => void): VolumeSlider {
  const value = element('output', 'setting__value');
  const showValue = (percent: string): void => {
    value.textContent = `${percent}%`;
  };
  const control = input('range', (el) => {
    showValue(el.value);
    onVolume(Number(el.value) / 100);
  });
  control.min = '0';
  control.max = '100';
  control.step = '5';
  control.dataset['testid'] = testId;
  const row = element('label', 'setting');
  const head = element('span', 'setting__head');
  head.append(element('span', 'label', label), value);
  row.append(head, control);
  return {
    row,
    control,
    set(volume) {
      control.value = String(Math.round(volume * 100));
      showValue(String(Math.round(volume * 100)));
    },
  };
}

function shakeChoices(onShake: (shake: ScreenShake) => void): { group: HTMLElement; set(shake: ScreenShake): void } {
  const group = element('fieldset', 'setting');
  group.append(element('legend', 'label', 'Screen shake'));
  const segments = element('div', 'segments');
  const radios = SHAKE_CHOICES.map(({ value, label }) => {
    const radio = input('radio', () => {
      onShake(value);
    });
    radio.name = 'screen-shake';
    radio.value = value;
    const segment = element('label', 'segment', label);
    segment.append(radio);
    segments.append(segment);
    return radio;
  });
  group.append(segments);
  return {
    group,
    set(shake) {
      for (const radio of radios) radio.checked = radio.value === shake;
    },
  };
}

/**
 * The settings screen: a glass card over the title or pause card that opened it. Controls report through
 * `actions` and are refreshed by `update`; Esc anywhere closes it, even from a focused slider.
 */
export function createSettingsCard(root: HTMLElement, actions: SettingsCardActions): SettingsCard {
  const { panel, card } = cardPanel('settings');
  panel.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', HEADING_ID);

  const music = volumeSlider('Music volume', 'settings-music', (musicVolume) => {
    actions.change({ musicVolume });
  });
  const effects = volumeSlider('Effects volume', 'settings-sfx', (sfxVolume) => {
    actions.change({ sfxVolume });
  });
  const shake = shakeChoices((screenShake) => {
    actions.change({ screenShake });
  });
  const leftHanded = input('checkbox', (el) => {
    actions.change({ leftHanded: el.checked });
  });
  leftHanded.dataset['testid'] = 'settings-left-handed';
  const leftHandedRow = element('label', 'setting setting--check');
  leftHandedRow.append(leftHanded, element('span', 'label', 'Left-handed controls'));
  effects.control.addEventListener('change', actions.previewSfx);
  const sound = chip('sound-toggle', actions.toggleMute, 'settings-sound');

  const heading = element('h2', 'heading', 'Settings');
  heading.id = HEADING_ID;
  const list = element('div', 'settings-list');
  list.append(music.row, effects.row, shake.group, leftHandedRow);
  const done = button('menu-button menu-button--primary', 'Done', actions.done);
  // Enter and Space on Done only press Done: they must not start or resume a run behind the card.
  keepActivationKeysLocal(done);
  const footer = element('div', 'chips');
  footer.append(sound, done);
  card.append(heading, list, footer);
  card.addEventListener('change', actions.save);
  root.append(panel);

  /** Esc closes the card from any focus. It stops here: the game's own Esc (resume, back to title) must not also run. */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape') return;
    e.stopPropagation();
    if (!e.repeat) actions.done();
  };

  return {
    show() {
      panel.hidden = false;
      document.addEventListener('keydown', onKeyDown);
      music.control.focus();
    },
    hide() {
      panel.hidden = true;
      document.removeEventListener('keydown', onKeyDown);
    },
    update(settings, touchScreen) {
      music.set(settings.musicVolume);
      effects.set(settings.sfxVolume);
      shake.set(settings.screenShake);
      leftHanded.checked = settings.leftHanded;
      leftHandedRow.hidden = !touchScreen;
      showSoundState(sound, settings.muted);
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      panel.remove();
    },
  };
}
