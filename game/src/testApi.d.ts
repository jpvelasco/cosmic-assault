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

/** The boss in the galaxy in play, once its approach is over. */
interface CosmicAssaultTestBoss {
  readonly id: import('./content/types').BossId;
  readonly state: import('./sim/boss/behaviour').BossState;
  readonly hp: number;
  readonly maxHp: number;
  readonly phase: import('./sim/boss/behaviour').BossPhase;
  /** The attack being telegraphed, else null. */
  readonly windup: import('./content/types').AttackId | null;
  /** The attack running, else null. */
  readonly active: import('./content/types').AttackId | null;
  /** Whether a blow on its core can hurt it now: false while its shards shield it, and while a hangar is shut. */
  readonly vulnerable: boolean;
  /** Its shards or other parts still alive. */
  readonly liveParts: number;
  /** Where a shot does harm now, or null if nowhere does. */
  readonly target: { readonly x: number; readonly y: number } | null;
}

/** A box in CSS px from the viewport's top left. */
interface CosmicAssaultTestRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface CosmicAssaultTestState {
  /** The screen shown; the same as `screen`, kept from before there were more screens than modes. */
  readonly mode: import('./app/flow').Screen;
  readonly screen: import('./app/flow').Screen;
  /** The galaxy in play or just played (on its end card); null before the first run. */
  readonly galaxy: import('./content/types').GalaxyId | null;
  /** A frozen copy of the save in memory. A debug run (`?galaxy=`, `?seed=` or `?lives=`) keeps it in memory only. */
  readonly save: import('./meta/save').SaveData;
  /** The Rank run as carried into the galaxy in play (on results, into the next one); null outside Rank. A frozen copy. */
  readonly rankRun: import('./meta/rankRun').RankRun | null;
  /** Score, lives and counts are 0 and ship is null while no run exists (title and menu screens). */
  readonly score: number;
  readonly lives: number;
  readonly ship: CosmicAssaultTestShip | null;
  readonly asteroidCount: number;
  readonly projectileCount: number;
  /** The pickups on the field, with the seconds each has before it expires (it blinks under 2); empty outside a run. */
  readonly pickups: readonly { readonly id: number; readonly kind: import('./content/types').PickupId; readonly x: number; readonly y: number; readonly expiresIn: number }[];
  /** The foes on the field; empty outside a galaxy run. */
  readonly foes: readonly { readonly id: number; readonly kind: import('./content/types').FoeKind; readonly x: number; readonly y: number }[];
  /** The gravity well being telegraphed or pulling (at most one), with the seconds until it starts or ends; empty when there is none. */
  readonly wells: readonly { readonly id: number; readonly stage: 'warning' | 'active'; readonly x: number; readonly y: number; readonly intensity: 1 | 2 | 3; readonly remaining: number }[];
  /** The boss once its approach is over; null before then and outside a boss galaxy. */
  readonly boss: CosmicAssaultTestBoss | null;
  /** How many sim events of each type the run in play has produced (a shot fired, a boss shot deflected, a hangar opened ...), from its first step. */
  readonly events: Readonly<Partial<Record<import('./sim/events').SimEvent['type'], number>>>;
  /** The timed effects running (doubleShot, rapidFire, spreadLaser, shield), each with its seconds left; one that is off is absent. */
  readonly effects: Readonly<Partial<Record<import('./content/pickups').TimedPickupId, number>>>;
  /** The weapon tier, 0–3; 0 outside a run. */
  readonly weaponTier: import('./content/types').WeaponTier;
  /** Whether the Shield is up. */
  readonly shield: boolean;
  /** The HUD pills drawn on the last frame; empty before the first run is drawn. */
  readonly hudRects: readonly CosmicAssaultTestRect[];
  /** Frames the renderer has drawn; a still screen (paused, game over) draws only when something changes. */
  readonly drawCount: number;
  /** How much larger than their field size the ship, rocks, shots and effects are drawn; 1 on a large screen. Hitboxes never change. */
  readonly visualScale: { readonly ship: number; readonly rock: number; readonly shot: number; readonly effect: number };
  /** The quality level in force: index into the ladder (0 high … 3 lowest) and its name. */
  readonly quality: { readonly index: number; readonly name: 'high' | 'medium' | 'low' | 'lowest' };
  /** Frame times of the current run in ms, less its first 3 s; zeros until a run is past that. */
  readonly frameStats: { readonly count: number; readonly p50: number; readonly p95: number; readonly longFrames: number };
  /** Whether sound is muted; saved across visits. */
  readonly muted: boolean;
  /** The colour look in force: the last run's galaxy's palette ('drift' before any run). */
  readonly palette: import('./content/types').PaletteId;
  /** The music theme chosen (it changes at the next bar line): a galaxy's, its boss variant from the boss intro, the last Dimension's on a menu. */
  readonly musicTheme: import('./audio/themes').ThemeId;
  /** The settings in force (volumes 0–1, shake mode, touch layout); saved under `cosmic-assault.v2.settings`. */
  readonly settings: import('./app/settings').Settings;
  /** The motion rules in force: reduced motion (the browser's setting) and whether shake is on once the shake setting is applied. */
  readonly motion: { readonly reducedMotion: boolean; readonly shake: boolean };
  /** 'none' until the first key press or pointer press creates the audio context. */
  readonly audioState: 'none' | 'suspended' | 'running' | 'closed';
  /** Entries in the in-memory event and error log (at most 200). */
  readonly logSize: number;
  /** Whether the page is in full screen (`document.fullscreenElement` is set). */
  readonly fullscreen: boolean;
}

interface CosmicAssaultTestApi {
  readonly version: 3;
  getState(): CosmicAssaultTestState;
  /**
   * Steps the run in play by fixed sim steps for `seconds`, with the controls held now, through the same event
   * handling as a frame; stops early once the run leaves play (a clear at warp start, or a game over).
   */
  fastForward(seconds: number): void;
  /**
   * Lands `damage` shots on the boss, each where it does harm (`bossTarget`): the core, or while the core is shielded a
   * live part, or the Hive Carrier's open hangar, so a shielded boss takes fewer than `damage` hit points. The blow that
   * empties it kills it, and the next step ends the galaxy, warping out while the boss dies. Throws unless a boss is
   * fighting (not in its intro, dying or down) and some shot can hurt it now.
   */
  damageBoss(damage: number): void;
  /**
   * Drops a pickup of `kind` onto the ship at the next step, where it is announced (the first-drop callout), collected
   * and counted like a kill's drop. Throws outside a galaxy run.
   */
  grantPickup(kind: import('./content/types').PickupId): void;
  /** Makes the next guarded frame throw `Error(DELIBERATE_CRASH)` (src/testBridge.ts), which shows the recovery card. */
  crash(): void;
}

interface Window {
  __COSMIC_ASSAULT_TEST_API__?: CosmicAssaultTestApi;
}
