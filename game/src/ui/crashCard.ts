import type { Toast } from './toast';
import { button, cardPanel, element } from './dom';

export interface CrashCardActions {
  /** The text Copy report puts on the clipboard. */
  readonly report: () => string;
  readonly toast: Toast;
}

export interface CrashCard {
  /** Shows the card over everything and moves keyboard focus to Try again. */
  show(): void;
  dispose(): void;
}

export const CRASH_TITLE = 'Something went wrong';
export const CRASH_BODY = 'The game hit an error and stopped. Your settings are safe.';
export const TOAST_REPORT_COPIED = 'Report copied';

/** A read-only box for the report text, which the player copies by hand when the clipboard is unavailable. */
function selectedReport(): HTMLTextAreaElement {
  const box = element('textarea', 'crash-report');
  box.readOnly = true;
  box.setAttribute('aria-label', 'Report text, selected for copying');
  return box;
}

/**
 * The recovery card shown after a crash. It uses the glass card of the other screens and works without the
 * game loop: Try again reloads the page, and Copy report never throws or logs, whatever the clipboard does.
 */
export function createCrashCard(root: HTMLElement, { report, toast }: CrashCardActions): CrashCard {
  const { panel, card } = cardPanel('crash');
  panel.hidden = true;
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-label', CRASH_TITLE);
  const tryAgain = button('menu-button menu-button--primary', 'Try again', () => {
    location.reload();
  });
  let fallback: HTMLTextAreaElement | null = null;

  const copy = async (): Promise<void> => {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      toast.show(TOAST_REPORT_COPIED);
    } catch {
      // No clipboard API or permission: show the text to copy by hand. Logging here would only add noise to the report.
      fallback ??= selectedReport();
      fallback.value = text;
      card.append(fallback);
      fallback.focus();
      fallback.select();
    }
  };

  card.append(
    element('h2', 'heading', CRASH_TITLE),
    element('p', 'hint', CRASH_BODY),
    tryAgain,
    button('menu-button', 'Copy report', () => void copy()),
  );
  root.append(panel);

  return {
    show() {
      panel.hidden = false;
      tryAgain.focus();
    },
    dispose() {
      panel.remove();
    },
  };
}
