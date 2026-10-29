import type { Look } from '../content/cosmetics';
import type { TouchControls } from '../input/touchControls';
import type { CornerBox } from '../render/hud';
import type { Renderer } from '../render/renderer';
import { listen } from '../ui/dom';
import { TOUCH_STYLE_QUERY } from '../ui/hints';
import type { Overlay, OverlayState } from '../ui/overlay';
import type { RotatePrompt } from '../ui/rotatePrompt';
import { createSafeAreaProbe } from '../ui/safeArea';
import type { SettingsCard } from '../ui/settingsCard';
import type { Screen } from './flow';
import type { Hangar } from './hangar';
import type { Records } from './records';
import type { Settings } from './settings';

/** How long the pointer must rest during play before the cursor is hidden. */
const IDLE_CURSOR_MS = 2000;

/** What the screens show; the view works out the covers, the input style and the touch layer from it. */
export type ViewState = Omit<OverlayState, 'covered' | 'inputStyle'> & {
  readonly settings: Settings;
  readonly settingsOpen: boolean;
  /** The skin and trail the ship draws, with unlocks applied. */
  readonly look: Look;
};

export interface ViewSyncDeps {
  readonly overlay: Overlay;
  readonly settingsCard: SettingsCard;
  /** The records card, and whether it is up. */
  readonly records: Pick<Records, 'card' | 'open'>;
  /** The Hangar card, and whether it is up. */
  readonly hangar: Pick<Hangar, 'card' | 'open'>;
  readonly rotatePrompt: RotatePrompt;
  readonly touch: TouchControls;
  readonly renderer: Pick<Renderer, 'setHudBounds' | 'setLook'>;
  read(): ViewState;
  screen(): Screen;
  /** After a crash the recovery card owns the screen and the view stays as it was. */
  tripped(): boolean;
  /** The phone turned upright: a run in play pauses, and stays paused when it turns back. */
  onTurnUpright(): void;
}

export interface ViewSync {
  /** Brings the cards (the settings, records and Hangar cards too), their `inert` covers, the rotate prompt, the touch layer, the ship's look and the HUD bounds in line with the state. */
  sync(): void;
  /** A phone held upright: the game needs the wide screen, so it asks for a turn instead of playing. */
  needsRotation(): boolean;
  /** The page is upright, taller than it is wide, whatever the device. */
  portrait(): boolean;
  /** Hides the cursor after it rests for `IDLE_CURSOR_MS` in play; any move, and leaving play or a crash, brings it back. */
  armIdleCursor(): void;
  /** Keeps the HUD inside the safe area and, on touch screens, clear of the pause button. */
  syncHudBounds(): void;
  dispose(): void;
}

export function createViewSync(root: HTMLElement, deps: ViewSyncDeps): ViewSync {
  const { overlay, settingsCard, records, hangar, rotatePrompt, touch, renderer } = deps;
  const safeArea = createSafeAreaProbe(root);
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const touchStyle = window.matchMedia(TOUCH_STYLE_QUERY);
  const portrait = window.matchMedia('(orientation: portrait)');
  /** The touch pause button's corner, kept while the button is hidden: it is anchored top-right, so it holds across resizes. */
  let pauseCorner: CornerBox | null = null;
  let idleCursorTimer: number | undefined;

  const needsRotation = (): boolean => touchStyle.matches && portrait.matches;

  function syncHudBounds(): void {
    if (!coarsePointer.matches) pauseCorner = null;
    else {
      const button = touch.pauseRect();
      if (button !== null) pauseCorner = { width: root.clientWidth - button.left, height: button.bottom };
    }
    renderer.setHudBounds({ insets: safeArea.read(), topRight: pauseCorner });
  }

  function sync(): void {
    if (deps.tripped()) return;
    const { settings, settingsOpen, look, ...state } = deps.read();
    const rotating = needsRotation();
    overlay.update({ ...state, covered: settingsOpen || records.open || hangar.open || rotating, inputStyle: touchStyle.matches ? 'touch' : 'keys' });
    settingsCard.update(settings, coarsePointer.matches);
    records.card.update(state.save, state.today);
    hangar.card.update(state.save, settings);
    for (const card of [settingsCard, records.card, hangar.card]) card.cover(rotating);
    renderer.setLook(look);
    rotatePrompt.show(rotating);
    touch.show(state.flow.screen === 'playing' && coarsePointer.matches);
    syncHudBounds();
  }

  function armIdleCursor(): void {
    clearTimeout(idleCursorTimer);
    idleCursorTimer = undefined;
    document.body.classList.remove('cursor-idle');
    if (deps.screen() !== 'playing' || deps.tripped()) return;
    idleCursorTimer = window.setTimeout(() => {
      document.body.classList.add('cursor-idle');
    }, IDLE_CURSOR_MS);
  }

  /** A screen or pointer change. */
  const onPlatformChange = (): void => {
    if (needsRotation()) deps.onTurnUpright();
    sync();
  };
  const unlisteners = [
    listen(touchStyle, 'change', onPlatformChange),
    listen(coarsePointer, 'change', onPlatformChange),
    listen(portrait, 'change', onPlatformChange),
    listen(window, 'pointermove', armIdleCursor),
  ];

  return {
    sync,
    needsRotation,
    portrait: () => portrait.matches,
    armIdleCursor,
    syncHudBounds,
    dispose() {
      for (const unlisten of unlisteners) unlisten();
      clearTimeout(idleCursorTimer);
      document.body.classList.remove('cursor-idle');
      safeArea.dispose();
    },
  };
}
