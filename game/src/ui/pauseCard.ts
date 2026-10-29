import type { GalaxyMode } from '../sim/scoring';
import { button, cardPanel, element, PRIMARY_BUTTON, withTestId } from './dom';
import type { HintCopy } from './hints';

/** Where the pause card's Quit stands: in Rank a first press arms it, and only a press while it is armed quits. */
export type QuitStep = 'ready' | 'armed';

/** Quit's label in `mode` at `step`: in Rank a Quit mid-galaxy forfeits it, so the button says what it costs, and asks again once armed. */
export function quitLabel(mode: GalaxyMode | null, step: QuitStep): string {
  if (mode !== 'rank') return 'Quit to title';
  return step === 'armed' ? 'Really quit? Costs a life' : 'Quit (costs a life)';
}

/** What a press of Quit does in `mode` at `step`: the first press in Rank arms it; any other press quits. */
export function pressQuit(mode: GalaxyMode | null, step: QuitStep): 'arm' | 'quit' {
  return mode === 'rank' && step === 'ready' ? 'arm' : 'quit';
}

export interface PauseCard {
  readonly panel: HTMLElement;
  /** Labels Quit for the run's `mode` and shows the keys `hints` name, beside Resume and under the buttons. */
  update(mode: GalaxyMode | null, hints: HintCopy): void;
  /** Puts focus on Resume, so Enter, Space and pad A resume. */
  focusResume(): void;
  /** Takes back an armed Quit, back to its first label; true if one was armed. */
  disarm(): boolean;
}

/** The pause card: Resume, a Quit that asks twice in Rank, a line on the keys that resume, and the chip row `chips`. */
export function createPauseCard(actions: { readonly resume: () => void; readonly quit: () => void }, chips: HTMLElement): PauseCard {
  const { panel, card } = cardPanel('pause');
  const resumeKey = element('span', 'key-hint');
  // Drawn only: the button's name stays "Resume", and aria-keyshortcuts names its keys.
  resumeKey.setAttribute('aria-hidden', 'true');
  const resume = withTestId(button(PRIMARY_BUTTON, 'Resume', actions.resume), 'resume');
  resume.setAttribute('aria-keyshortcuts', 'Escape P');
  resume.append(resumeKey);
  let mode: GalaxyMode | null = null;
  let step: QuitStep = 'ready';
  const quit = withTestId(
    button('menu-button', '', () => {
      if (pressQuit(mode, step) === 'quit') actions.quit();
      else {
        step = 'armed';
        showQuit();
      }
    }),
    'quit',
  );
  const hint = withTestId(element('p', 'hint'), 'pause-hint');
  card.append(element('h2', 'heading', 'Paused'), resume, quit, hint, chips);

  function showQuit(): void {
    quit.textContent = quitLabel(mode, step);
  }

  return {
    panel,
    update(runMode, hints) {
      mode = runMode;
      showQuit();
      resumeKey.textContent = hints.resumeKey;
      resumeKey.hidden = hints.resumeKey === '';
      hint.textContent = hints.paused;
      hint.hidden = hints.paused === '';
    },
    focusResume() {
      resume.focus({ preventScroll: true });
    },
    disarm() {
      if (step === 'ready') return false;
      step = 'ready';
      showQuit();
      return true;
    },
  };
}
