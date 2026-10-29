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
  readonly style = { setProperty: (): void => undefined };
  readonly classList = {
    add: (...names: string[]): void => {
      this.className = [...new Set([...this.classes(), ...names])].join(' ');
    },
    toggle: (name: string, on: boolean): void => {
      this.className = [...this.classes().filter((c) => c !== name), ...(on ? [name] : [])].join(' ');
    },
  };
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, (() => void)[]>();

  constructor(readonly tagName: string) {}

  private classes(): string[] {
    return this.className.split(' ').filter((c) => c !== '');
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
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
