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
}

interface CosmicAssaultTestApi {
  readonly version: 3;
  getState(): CosmicAssaultTestState;
}

interface Window {
  __COSMIC_ASSAULT_TEST_API__?: CosmicAssaultTestApi;
}
