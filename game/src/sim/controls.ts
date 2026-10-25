export interface Stick {
  readonly angle: number;
  /** Distance in reference px: 60 is full thrust. */
  readonly distance: number;
}

export interface Controls {
  readonly turn: -1 | 0 | 1;
  readonly thrust: boolean;
  readonly fire: boolean;
  readonly stick: Stick | null;
}

export const NO_CONTROLS: Controls = { turn: 0, thrust: false, fire: false, stick: null };
