export interface Toast {
  /** Shows `text` in a pill for a moment, replacing any toast already up. */
  show(text: string): void;
  dispose(): void;
}

export const TOAST_MS = 1200;

/** A short status pill over every screen, announced politely to screen readers. */
export function createToast(root: HTMLElement): Toast {
  const el = document.createElement('p');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.hidden = true;
  root.append(el);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const hide = (): void => {
    el.hidden = true;
    timer = null;
  };

  return {
    show(text) {
      if (timer !== null) clearTimeout(timer);
      el.textContent = text;
      el.hidden = false;
      timer = setTimeout(hide, TOAST_MS);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      el.remove();
    },
  };
}
