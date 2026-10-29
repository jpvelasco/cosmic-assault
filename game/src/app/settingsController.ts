import type { AudioEngine } from '../audio/engine';
import type { TouchControls } from '../input/touchControls';
import type { Effects } from '../render/effects';
import { listen } from '../ui/dom';
import { createSettingsCard, type SettingsCard } from '../ui/settingsCard';
import type { Toast } from '../ui/toast';
import { createCardToggle, type CardToggle, type CardToggleDeps } from './cardToggle';
import type { HitStop } from './hitStop';
import { saveSettings, shakeEnabled, type Settings } from './settings';

const TOAST_MUTED = 'Muted';
const TOAST_SOUND_ON = 'Sound on';

export interface SettingsControllerDeps extends CardToggleDeps {
  readonly storage: Storage | null;
  /** The settings loaded at start; the audio engine was built from them. */
  readonly initial: Settings;
  readonly audio: Pick<AudioEngine, 'muted' | 'setMuted' | 'setVolumes' | 'play'>;
  readonly toast: Toast;
  readonly touch: Pick<TouchControls, 'setLeftHanded'>;
  readonly hitStop: HitStop;
  readonly effects: Effects;
}

export interface SettingsController {
  readonly settings: Settings;
  /** Puts a change into effect and saves it at once, for a choice made outside the settings card (the Hangar's). */
  readonly choose: (patch: Partial<Settings>) => void;
  /** The settings card over the title, mode select or pause card, and whether it is up; the run behind it, if any, stays as it was. */
  readonly toggle: CardToggle<SettingsCard>;
  /** The M key and the sound chips. */
  readonly toggleMute: () => void;
  readonly dispose: () => void;
}

/** Owns the settings in force and the settings card: applies changes live, saves them, and opens and closes the card. */
export function createSettingsController(root: HTMLElement, deps: SettingsControllerDeps): SettingsController {
  const { storage, audio, toast, touch, hitStop, effects } = deps;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let settings = deps.initial;
  /** The save warning is given once: a slider that is dragged again and again must not flood the console. */
  let warnedStorage = false;

  /** Writes the current settings to storage. A refusal is a warning, not an error: the changes still hold for this visit. */
  function persistSettings(): void {
    if (!saveSettings(storage, settings) && !warnedStorage) {
      warnedStorage = true;
      console.warn('Could not save your settings, so they will reset on reload. Allow site storage for this page to keep them.');
    }
  }

  /** The one motion source: reduced motion turns off hit-stop, flash and shake; the shake setting can also turn off shake alone. */
  function syncMotion(): void {
    hitStop.reducedMotion = reducedMotion.matches;
    effects.reducedMotion = reducedMotion.matches;
    effects.shakeEnabled = shakeEnabled(settings.screenShake, reducedMotion.matches);
  }

  /** Puts the settings into effect: volumes, the shake gate and the touch layout. Saving is separate (`persistSettings`). */
  function applySettings(patch: Partial<Settings>): void {
    settings = { ...settings, ...patch };
    audio.setVolumes(settings.musicVolume, settings.sfxVolume);
    syncMotion();
    touch.setLeftHanded(settings.leftHanded);
  }

  function toggleMute(): void {
    audio.setMuted(!audio.muted);
    toast.show(audio.muted ? TOAST_MUTED : TOAST_SOUND_ON);
    settings = { ...settings, muted: audio.muted };
    deps.syncView();
    persistSettings();
  }

  /** A change made outside the settings card: applied, saved and shown at once. */
  function choose(patch: Partial<Settings>): void {
    applySettings(patch);
    persistSettings();
    deps.syncView();
  }

  const toggle = createCardToggle(
    'settings',
    (done) =>
      createSettingsCard(root, {
        change: applySettings,
        save: persistSettings,
        toggleMute,
        previewSfx: () => {
          audio.play('uiClick');
        },
        done,
      }),
    deps,
  );
  const unlisten = listen(reducedMotion, 'change', syncMotion);
  applySettings({});

  return {
    get settings() {
      return settings;
    },
    choose,
    toggle,
    toggleMute,
    dispose: () => {
      unlisten();
      toggle.card.dispose();
    },
  };
}
