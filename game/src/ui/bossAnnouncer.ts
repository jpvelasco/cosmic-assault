import { BOSSES } from '../content/bosses';
import type { SimEvent } from '../sim/events';
import { element } from './dom';

export interface BossAnnouncer {
  /** Announces a boss arriving, changing phase, its core exposed or shielded and its going down, and clears as a galaxy starts; other events say nothing. */
  handle(events: readonly SimEvent[]): void;
  dispose(): void;
}

/**
 * The boss fight for screen readers. The HP bar is drawn on the canvas, which is decorative (`aria-hidden`), so this
 * visually hidden status region says what the bar shows as it changes: the boss's arrival, each phase and its end.
 */
export function createBossAnnouncer(root: HTMLElement): BossAnnouncer {
  const el = element('p', 'visually-hidden');
  el.setAttribute('role', 'status');
  root.append(el);
  /** The boss named by the last intro: a phase change names no boss. */
  let name = '';
  return {
    handle(events) {
      for (const event of events) {
        // A new galaxy starts with nothing said, so the same message in a retry is a change a screen reader reads.
        if (event.type === 'galaxyStart') {
          el.textContent = '';
        } else if (event.type === 'bossIntro') {
          name = BOSSES[event.id].name;
          el.textContent = `${name} approaches`;
        } else if (event.type === 'bossPhase') {
          el.textContent = `${name}, phase ${String(event.phase)} of 3`;
        } else if (event.type === 'bossExposed') {
          el.textContent = `${name}'s core is exposed`;
        } else if (event.type === 'bossShielded') {
          el.textContent = `${name}'s core is shielded again`;
        } else if (event.type === 'bossDown') {
          el.textContent = `${BOSSES[event.id].name} down`;
        }
      }
    },
    dispose() {
      el.remove();
    },
  };
}
