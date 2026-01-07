/**
 * Math Utilities
 * Pure functions for mathematical operations used throughout the game.
 */

/**
 * Basic circle collision detection
 * @param {number} x1 - First circle center X
 * @param {number} y1 - First circle center Y
 * @param {number} r1 - First circle radius
 * @param {number} x2 - Second circle center X
 * @param {number} y2 - Second circle center Y
 * @param {number} r2 - Second circle radius
 * @returns {boolean} True if circles overlap
 */
export function circleCollision(x1, y1, r1, x2, y2, r2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    const distanceSq = dx * dx + dy * dy;
    const radiusSum = r1 + r2;
    return distanceSq < radiusSum * radiusSum;
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Get distance between two points
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number} Distance
 */
export function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get squared distance between two points (faster, good for comparisons)
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number} Squared distance
 */
export function distanceSquared(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
}

/**
 * Normalize an angle to be between -PI and PI
 * @param {number} angle - Angle in radians
 * @returns {number} Normalized angle
 */
export function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

/**
 * Get random number between min and max
 * @param {number} min
 * @param {number} max
 * @returns {number} Random number
 */
export function randomRange(min, max) {
    return min + Math.random() * (max - min);
}

/**
 * Get random integer between min and max (inclusive)
 * @param {number} min
 * @param {number} max
 * @returns {number} Random integer
 */
export function randomInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Get random item from array
 * @template T
 * @param {T[]} array
 * @returns {T} Random item
 */
export function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
}
