/**
 * Game Constants
 * All game configuration constants in one place.
 */

//=============================================================================
// VISUAL CONSTANTS
//=============================================================================

export const SHIP_SIZE = 20;
export const MAX_PARTICLES = 150;

// Colors
export const SHIP_COLOR = "#39FF14"; // Neon Green
export const PROJECTILE_COLOR = "#FF00FF"; // Magenta
export const ASTEROID_COLOR = "#4080FF"; // Blue
export const TEXT_COLOR = "#39FF14";
export const DEFAULT_FONT = "'Courier New', Courier, monospace";

//=============================================================================
// POWERUP CONFIGURATION
//=============================================================================

export const POWERUP_TYPES = ["doubleShot", "rapidFire", "shield", "fieldBomb"];

export const POWERUP_COLORS = {
    doubleShot: "#FF00FF", // Magenta
    rapidFire: "#FFFF00", // Yellow
    shield: "#00FFFF", // Cyan
    fieldBomb: "#FF5500"  // Orange
};

export const POWERUP_CONFIG = {
    doubleShot: { duration: 10, color: POWERUP_COLORS.doubleShot },
    rapidFire: { duration: 10, color: POWERUP_COLORS.rapidFire },
    shield: { duration: 15, color: POWERUP_COLORS.shield },
    fieldBomb: { duration: 0, color: POWERUP_COLORS.fieldBomb } // Instant
};

// Powerup spawn chances
export const BASE_POWERUP_CHANCE = 0.15;
export const LEVEL_POWERUP_REDUCTION = 0.02;
export const MIN_POWERUP_CHANCE = 0.05;

//=============================================================================
// EFFECTS CONFIGURATION
//=============================================================================

export const EFFECTS = {
    explosion: {
        baseSize: 30,
        color: ASTEROID_COLOR,
        speed: 100,
        shake: 0.5,
        sound: 'explosion'
    },
    powerup: {
        baseSize: 20,
        color: '#FFFF00',
        speed: 50,
        shake: 0.2,
        sound: 'powerup'
    },
    fieldBomb: {
        baseSize: 100,
        color: POWERUP_COLORS.fieldBomb,
        speed: 200,
        shake: 1.0,
        sound: 'nuke'
    },
    shieldHit: {
        baseSize: 20,
        color: POWERUP_COLORS.shield,
        speed: 80,
        shake: 0.3,
        sound: 'explosion'
    }
};

//=============================================================================
// NOTIFICATION MESSAGES
//=============================================================================

export const NOTIFICATIONS = {
    levelUp: (level, multiplier) => ({
        main: `LEVEL ${level}!`,
        sub: `SCORE MULTIPLIER: ${multiplier.toFixed(1)}x`,
        color: '#FFFF00',
        duration: 2
    }),
    bonusRound: (multiplier) => ({
        main: 'BONUS ROUND!',
        sub: `${multiplier}X POINTS!`,
        color: '#FFFF00',
        duration: 2
    }),
    dangerZone: () => ({
        main: 'DANGER ZONE!',
        color: '#FF0000',
        duration: 2
    }),
    powerupCollected: (type) => ({
        main: type.toUpperCase() + '!',
        color: POWERUP_COLORS[type] || '#FFFFFF',
        duration: 1.5
    }),
    meteorShowerIncoming: () => ({
        main: 'METEOR SHOWER INCOMING!',
        color: '#FF0000',
        duration: 2
    }),
    meteorShowerEnded: () => ({
        main: 'METEOR SHOWER ENDED',
        color: '#FFFF00',
        duration: 1.5
    }),
    bonusRoundEnded: () => ({
        main: 'BONUS ROUND ENDED',
        color: '#FFFF00',
        duration: 1.5
    }),
    weaponUpgrade: (level) => ({
        main: level === 3 ? 'MAXIMUM FIREPOWER!' : 'WEAPON UPGRADED!',
        color: SHIP_COLOR,
        duration: 1.5
    }),
    gravityWell: () => ({
        main: "GRAVITY WELL",
        color: "#FF00FF",
        duration: 2
    }),
    repulsionField: () => ({
        main: "REPULSION FIELD",
        color: "#00FFFF",
        duration: 2
    }),
    fieldBombDetonation: () => ({
        main: "FIELD BOMB!",
        color: POWERUP_COLORS.fieldBomb,
        duration: 2
    }),
    bonusPoints: (points) => ({
        main: `+${points}`,
        color: "#FFFF00",
        duration: 1
    })
};

//=============================================================================
// LEVEL PROGRESSION
//=============================================================================

export const LEVEL_THRESHOLDS = [0, 5000, 15000, 30000, 50000, 75000, 100000];

// Weapon upgrade score thresholds
export const WEAPON_UPGRADE_THRESHOLDS = {
    2: 8000,
    3: 25000
};

//=============================================================================
// ASTEROID CONFIGURATION
//=============================================================================

// Size indices: 0=Large, 1=Medium, 2=Small, 3=Tiny
export const ASTEROID_SIZES = {
    LARGE: 0,
    MEDIUM: 1,
    SMALL: 2,
    TINY: 3
};

export const ASTEROID_RADII = [60, 40, 25, 15];
export const ASTEROID_BASE_SPEEDS = [60, 80, 110, 140];
export const ASTEROID_SCORES = [20, 50, 100, 150];

//=============================================================================
// PLAYER CONFIGURATION
//=============================================================================

export const PLAYER_CONFIG = {
    turnSpeed: 5,           // Radians per second
    thrustPower: 200,       // Acceleration
    drag: 0.98,             // Velocity multiplier per frame
    maxSpeed: 350,          // Maximum pixels per second
    invulnerabilityTime: 3, // Seconds
    baseFireRate: 0.3,      // Seconds between shots
    projectileSpeed: 450
};

//=============================================================================
// GAME TIMING
//=============================================================================

export const TIMING = {
    baseAsteroidSpawnInterval: 3.5,
    minAsteroidSpawnInterval: 0.5,
    levelSpawnReduction: 0.3,
    meteorShowerBaseDuration: 8,
    bonusRoundDuration: 15,
    gravityFieldLifespan: 15,
    dangerZoneLifespan: 10,
    dangerZoneWarningTime: 2,
    powerupLifespan: 12,
    projectileLifespan: 1.2
};

//=============================================================================
// GAME STATE ENUM
//=============================================================================

export const GAME_STATES = Object.freeze({
    TITLE: 'title',
    PLAYING: 'playing',
    GAME_OVER: 'gameOver',
    PAUSED: 'paused',
});

//=============================================================================
// POWERUP TYPE ENUM
//=============================================================================

export const POWERUP_TYPE = Object.freeze({
    DOUBLE_SHOT: 'doubleShot',
    RAPID_FIRE: 'rapidFire',
    SHIELD: 'shield',
    FIELD_BOMB: 'fieldBomb',
});

//=============================================================================
// WEAPON SPREAD TABLE
//=============================================================================

// Indexed by effectiveLevel (weaponLevel * weaponCountMultiplier), clamped to last entry.
export const WEAPON_SPREAD = [
    null,                                           // 0 (unused)
    { count: 1, angles: [0] },                      // level 1
    { count: 2, angles: [-0.12, 0.12] },            // level 2
    { count: 3, angles: [0, -0.18, 0.18] },         // level 3
    { count: 5, angles: [0, -0.18, 0.18, -0.30, 0.30] }, // level 4+
];

//=============================================================================
// FEATURE FLAGS
//=============================================================================

export const TEST_MODE = false;
