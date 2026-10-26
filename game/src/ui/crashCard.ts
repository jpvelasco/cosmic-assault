import type { Toast } from './toast';
import { button, cardPanel, element, PRIMARY_BUTTON } from './dom';

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
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', CRASH_TITLE);
  const tryAgain = button(PRIMARY_BUTTON, 'Try again', () => {
    location.reload();
  });
  const copyButton = button('menu-button', 'Copy report', () => void copy());
  let fallback: HTMLTextAreaElement | null = null;

  /** Whether the clipboard took the text. It can be missing or refuse; logging either would only add noise to the report. */
  const writeToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const copy = async (): Promise<void> => {
    const text = report();
    if (await writeToClipboard(text)) {
      toast.show(TOAST_REPORT_COPIED);
      return;
    }
    // No clipboard or permission: show the text to copy by hand.
    fallback ??= selectedReport();
    fallback.value = text;
    card.append(fallback);
    fallback.focus();
    fallback.select();
  };

  /** Keeps Tab inside the card, so the screens behind it cannot be reached. */
  const trapTab = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const stops = [tryAgain, copyButton, ...(fallback === null ? [] : [fallback])];
    const at = stops.findIndex((stop) => stop === document.activeElement);
    const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
    stops[next]?.focus();
    e.preventDefault();
  };

  card.append(element('h2', 'heading', CRASH_TITLE), element('p', 'hint', CRASH_BODY), tryAgain, copyButton);
  root.append(panel);

  return {
    show() {
      panel.hidden = false;
      document.addEventListener('keydown', trapTab);
      tryAgain.focus();
    },
    dispose() {
      document.removeEventListener('keydown', trapTab);
      panel.remove();
    },
  };
}
