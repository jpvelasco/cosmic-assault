/** Shape of the e2e-only test bridge (see src/testBridge.ts); release builds never set it. */
interface CosmicAssaultTestShip {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly thrusting: boolean;
  readonly invulnerable: boolean;
}

/** A box in CSS px from the viewport's top left. */
interface CosmicAssaultTestRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface CosmicAssaultTestState {
  readonly mode: import('./app/game').AppMode;
  readonly practiceLevel: number;
  /** Score, lives and counts are 0 and ship is null while no run exists (title screen). */
  readonly score: number;
  readonly lives: number;
  readonly ship: CosmicAssaultTestShip | null;
  readonly asteroidCount: number;
  readonly projectileCount: number;
  /** The HUD pills drawn on the last frame; empty before the first run is drawn. */
  readonly hudRects: readonly CosmicAssaultTestRect[];
  /** Frames the renderer has drawn; a still screen (paused, game over) draws only when something changes. */
  readonly drawCount: number;
  /** The quality level in force: index into the ladder (0 high … 3 lowest) and its name. */
  readonly quality: { readonly index: number; readonly name: 'high' | 'medium' | 'low' | 'lowest' };
  /** Frame times of the current run in ms, less its first 3 s; zeros until a run is past that. */
  readonly frameStats: { readonly count: number; readonly p50: number; readonly p95: number; readonly longFrames: number };
}

interface CosmicAssaultTestApi {
  readonly version: 3;
  getState(): CosmicAssaultTestState;
}

interface Window {
  __COSMIC_ASSAULT_TEST_API__?: CosmicAssaultTestApi;
}
