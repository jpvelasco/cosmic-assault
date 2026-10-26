export interface Toast {
  /** Shows `text` in a pill for `ms` (a moment by default), replacing any toast already up. */
  readonly show: (text: string, ms?: number) => void;
  dispose(): void;
}

export const TOAST_MS = 1200;
/** A first-drop callout says what a pickup does, so it stays up long enough to read. */
export const CALLOUT_MS = 2600;

/**
 * A short status pill over every screen. The live region stays in the accessibility tree
 * (hidden by opacity, not `hidden`) and gets its text afterwards, so screen readers announce it.
 */
export function createToast(root: HTMLElement): Toast {
  const el = document.createElement('p');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  root.append(el);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    el.classList.remove('toast--shown');
    el.textContent = '';
    timer = null;
  };

  return {
    show(text, ms = TOAST_MS) {
      if (timer !== null) clearTimeout(timer);
      el.textContent = text;
      el.classList.add('toast--shown');
      timer = setTimeout(clear, ms);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      el.remove();
    },
  };
}
