/** A moment a still is shot at: the attract demo behind the title, a hazard turned hostile, or the boss fighting. */
export type ShotScene =
  | { readonly kind: 'attract' }
  | { readonly kind: 'hazard'; readonly hazard: string; readonly after: number }
  | { readonly kind: 'boss'; readonly after: number };

export interface ReadmeShot {
  readonly file: string;
  readonly device: 'desktop' | 'phone';
  readonly scene: ShotScene;
  readonly claim?: string;
  readonly galaxy?: string;
  readonly seed?: number;
  readonly lives?: number;
}

/** docs/assets/screens/ at the repository root, where the README links its stills from. */
export const SHOTS_DIR: string;
export const SHOT_BYTE_CAP: number;
export const SHOTS: readonly ReadmeShot[];
export function shotQuery(shot: Pick<ReadmeShot, 'seed' | 'galaxy' | 'lives'>): string;
export function candidateWidths(native: number): number[];
