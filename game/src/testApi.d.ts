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
  /** A frozen copy of the save in memory. A debug run (`?galaxy=`, `?seed=`, `?lives=` or `?storm=`) keeps it in memory only; `?today=` is not one. */
  readonly save: import('./meta/save').SaveData;
  /** The Rank run as carried into the galaxy in play (on results, into the next one); null outside Rank. A frozen copy. */
  readonly rankRun: import('./meta/rankRun').RankRun | null;
  /** The Daily in play or on its end card: its date, twist and target score; null outside the Daily. */
  readonly daily: { readonly date: string; readonly twist: import('./content/daily').DailyTwistId; readonly target: number } | null;
  /** Score, lives and counts are 0 and ship is null while no run exists (title and menu screens). */
  readonly score: number;
  readonly lives: number;
  readonly ship: CosmicAssaultTestShip | null;
  readonly asteroidCount: number;
  readonly projectileCount: number;
  /** The pickups on the field, with the seconds each has before it expires (it blinks under 2); empty outside a run. */
  readonly pickups: readonly { readonly id: number; readonly kind: import('./content/types').PickupId; readonly x: number; readonly y: number; readonly expiresIn: number }[];
  /** The field the run plays in, in field units; null while no run exists. Bolts leave it rather than wrap. */
  readonly field: { readonly width: number; readonly height: number } | null;
  /** The foes on the field, each `charging` while its telegraphed attack winds up (a gunship aiming, a mine armed); empty outside a galaxy run. */
  readonly foes: readonly { readonly id: number; readonly kind: import('./content/types').FoeKind; readonly x: number; readonly y: number; readonly charging: boolean }[];
  /** The hostile bolts on the field, each with what fired it and, for a foe's, that foe's id (0 for a boss's); empty when there are none. */
  readonly bolts: readonly { readonly id: number; readonly source: import('./sim/foes/bolts').BoltSource; readonly owner: number; readonly x: number; readonly y: number; readonly radius: number }[];
  /**
   * The hazards being telegraphed or active (a gravity well ...), with the seconds until each turns hostile or ends; a
   * danger zone adds its size (`w` by `h`, centred on x, y), a warp rift its second mouth (`toX`, `toY`); empty when there are none.
   */
  readonly hazards: readonly { readonly id: number; readonly type: import('./content/types').HazardType; readonly stage: 'warning' | 'active'; readonly x: number; readonly y: number; readonly intensity: 1 | 2 | 3; readonly remaining: number; readonly w?: number; readonly h?: number; readonly toX?: number; readonly toY?: number }[];
  /** The boss once its approach is over; null before then and outside a boss galaxy. */
  readonly boss: CosmicAssaultTestBoss | null;
  /** How many sim events of each type the run in play has produced (a shot fired, a boss shot deflected, a hangar opened ...), from its first step. */
  readonly events: Readonly<Partial<Record<import('./sim/events').SimEvent['type'], number>>>;
  /** The timed effects running, each with its seconds left; one that is off is absent. */
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
  /** The quality level in force: index into the ladder (0 high … 3 lowest) and its name, and the display's frame interval in ms as the scaler measured it on idle screens (60 Hz until measured). */
  readonly quality: { readonly index: number; readonly name: 'high' | 'medium' | 'low' | 'lowest'; readonly displayMs: number };
  /** Frame times of the current run in ms, less its first 3 s (or since `restartFrameStats`, less 3 s); zeros until past that. `slowShare` is the share of frames over 1.5 display intervals. */
  readonly frameStats: { readonly count: number; readonly p50: number; readonly p95: number; readonly longFrames: number; readonly slowShare: number };
  /** Whether sound is muted; saved across visits. */
  readonly muted: boolean;
  /** The colour look in force: the last run's galaxy's palette ('drift' before any run). */
  readonly palette: import('./content/types').PaletteId;
  /** The music theme chosen (it changes at the next bar line): a galaxy's, its boss variant from the boss intro, the last Dimension's on a menu. */
  readonly musicTheme: import('./audio/themes').ThemeId;
  /** The settings in force (volumes 0–1, shake mode, touch layout); saved under `cosmic-assault.v2.settings`. */
  readonly settings: import('./app/settings').Settings;
  /** The skin and engine trail the ship draws: the chosen ones where unlocked, the defaults otherwise. */
  readonly look: import('./content/cosmetics').Look;
  /** The motion rules in force: reduced motion (the browser's setting) and whether shake is on once the shake setting is applied. */
  readonly motion: { readonly reducedMotion: boolean; readonly shake: boolean };
  /** 'none' until the first key press or pointer press creates the audio context. */
  readonly audioState: 'none' | 'suspended' | 'running' | 'closed';
  /** Entries in the in-memory event and error log (at most 200). */
  readonly logSize: number;
  /** Whether the page is in full screen (`document.fullscreenElement` is set). */
  readonly fullscreen: boolean;
  /** The sprite cache's use: the sprites it holds now and their keys (`kind|name|size`, a ship's name `palette:skin`), and how many it has evicted to stay within its capacity. */
  readonly spriteCache: import('./render/sprites').CacheUse | null;
  /**
   * The attract demo behind the title: whether it is on (a demo playing, or the pause before the next), the galaxy of the
   * demo, the demo frames drawn since it turned on, and whether a demo crash has stopped it for the session.
   */
  readonly attract: import('./app/e2eHooks').AttractState | null;
}

interface CosmicAssaultTestApi {
  readonly version: 9;
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
  /** Restarts `frameStats` as a run start does, its 3 s warm-up included, leaving the run and the quality level alone. */
  restartFrameStats(): void;
  /** Counts the title's idle stretch as over, so the next frame on the bare title starts the attract demo, as ATTRACT_IDLE_SECONDS without input would. */
  attractNow(): void;
  /** Makes the next guarded frame throw `Error(DELIBERATE_CRASH)` (src/testBridge.ts), which shows the recovery card. */
  crash(): void;
}

interface Window {
  __COSMIC_ASSAULT_TEST_API__?: CosmicAssaultTestApi;
}
