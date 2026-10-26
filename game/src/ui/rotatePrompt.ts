import { cardPanel, element } from './dom';

export const ROTATE_COPY = 'Rotate your phone to play';

export interface RotatePrompt {
  show(visible: boolean): void;
  dispose(): void;
}

/** A glass card that sits over every other screen on a phone held upright; the game is paused behind it. */
export function createRotatePrompt(root: HTMLElement): RotatePrompt {
  const { panel, card } = cardPanel('rotate');
  panel.hidden = true;
  panel.dataset['testid'] = 'rotate-prompt';
  panel.setAttribute('role', 'status');
  card.append(element('p', 'heading', ROTATE_COPY));
  root.append(panel);
  return {
    show(visible) {
      panel.hidden = !visible;
    },
    dispose() {
      panel.remove();
    },
  };
}
