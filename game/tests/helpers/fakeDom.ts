import { vi } from 'vitest';

/** The few element features the menu cards use, enough to build a card in Node and read it back. */
export class FakeElement {
  className = '';
  textContent = '';
  id = '';
  type = '';
  disabled = false;
  hidden = false;
  readonly dataset: Record<string, string | undefined> = {};
  readonly children: FakeElement[] = [];
  readonly classList = {
    add: (...names: string[]): void => {
      this.className = [this.className, ...names].join(' ').trim();
    },
  };

  constructor(readonly tagName: string) {}

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  /** Attributes and listeners are taken and dropped: the tests read what a card shows, not how it is labelled or wired. */
  setAttribute(): void {
    // Nothing to keep.
  }

  addEventListener(): void {
    // Nothing to keep.
  }

  /** This element or the first one under it with the `data-testid` `testId`. */
  byTestId(testId: string): FakeElement | null {
    if (this.dataset['testid'] === testId) return this;
    for (const child of this.children) {
      const found = child.byTestId(testId);
      if (found !== null) return found;
    }
    return null;
  }
}

/** Puts a `document` that makes FakeElements in place; undo it with `vi.unstubAllGlobals()`. */
export function stubDocument(): void {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) });
}

/** `el` as the FakeElement it is under `stubDocument`. */
export const asFake = (el: HTMLElement): FakeElement => el as unknown as FakeElement;
