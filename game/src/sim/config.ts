export const STEP_SECONDS = 1 / 120;
export const FIELD_HEIGHT = 720;
export const MIN_ASPECT = 4 / 3;
export const MAX_ASPECT = 21 / 9;
export const WRAP_MARGIN = 50;

export const PLAYER = {
  radius: 10,
  turnSpeed: 5,
  thrust: 200,
  dragPerFrame60: 0.98,
  maxSpeed: 350,
  invulnerableSeconds: 3,
  /** Live cadence: a 0.3 s timer checked once per 1/60 s frame fires every 19 frames. */
  fireInterval: 19 / 60,
  projectileSpeed: 450,
  inheritVelocity: 0.5,
  noseOffset: 16,
  startLives: 3,
} as const;

export const STICK = {
  deadZone: 10,
  fullThrust: 60,
  fullDragRelief: 120,
  maxDragReliefFactor: 0.5,
  maxDrag: 0.995,
} as const;

export const PROJECTILE = {
  radius: 3,
  lifespan: 1.2,
} as const;

export const ASTEROID = {
  radii: [60, 40, 25, 15],
  baseSpeeds: [60, 80, 110, 140],
  scores: [20, 50, 100, 150],
  speedJitter: [0.8, 1.2],
  spinMax: 1,
  vertexCount: [7, 11],
  jaggedness: 0.3,
  childAngleSpread: 1.5,
  childSpeedBoostMax: 0.3,
  safeRadius: 150,
} as const;

export const WEAPON_SPREAD: readonly (readonly number[])[] = [
  [0],
  [-0.12, 0.12],
  [0, -0.18, 0.18],
  [0, -0.18, 0.18, -0.3, 0.3],
];

export const MAX_WEAPON_TIER = 3;

/** How shots combine. A volley never exceeds `maxShots`: the widest tier fires 5, Double Shot adds 1 and Spread Laser 2. */
export const VOLLEY = {
  maxShots: 8,
  /** Double Shot turns the centre shot into a pair, this far to either side of the nose axis. */
  parallelOffset: 6,
  /** Spread Laser adds a shot at each of `+angle` and `-angle`. */
  spreadLaserAngle: 0.22,
  /** Rapid Fire multiplies the fire interval by this. */
  rapidFireScale: 0.6,
} as const;

export const PICKUP = {
  radius: 14,
  /** Units per second. */
  drift: 20,
  /** Seconds a pickup waits before it expires. */
  lifespan: 8,
  /** It blinks for this long before it expires. */
  blinkSeconds: 2,
  maxOnField: 2,
} as const;
