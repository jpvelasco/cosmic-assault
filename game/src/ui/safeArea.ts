import type { Insets } from '../render/hud';

export interface SafeAreaProbe {
  /** The current safe-area insets in CSS px (0 where the device has none). */
  read(): Insets;
  dispose(): void;
}

const PROBE_CSS =
  'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';

const px = (value: string): number => Number.parseFloat(value) || 0;

/** Canvas drawing cannot read CSS `env()`, so a hidden element padded by the insets reports them. */
export function createSafeAreaProbe(root: HTMLElement): SafeAreaProbe {
  const probe = document.createElement('div');
  probe.style.cssText = PROBE_CSS;
  root.append(probe);
  return {
    read() {
      const style = getComputedStyle(probe);
      return { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
    },
    dispose() {
      probe.remove();
    },
  };
}
