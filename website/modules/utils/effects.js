/**
 * Visual Effects Utilities
 * Helper functions for visual effects like blinking, pulsing, etc.
 */

/**
 * Returns true/false for blinking effect based on time
 * @param {number} time - Current time (Date.now() or similar)
 * @param {number} interval - Blink interval in milliseconds
 * @returns {boolean} Whether to show (true) or hide (false)
 */
export function blink(time, interval = 150) {
    return Math.floor(time / interval) % 2 === 0;
}

/**
 * Returns a pulsing value between (1 - amplitude) and (1 + amplitude)
 * @param {number} time - Current time
 * @param {number} rate - Pulse rate (higher = faster)
 * @param {number} amplitude - Pulse amplitude (0-1)
 * @returns {number} Pulse multiplier
 */
export function pulse(time, rate = 300, amplitude = 0.1) {
    return 1 + amplitude * Math.sin(time / rate);
}

/**
 * Returns a pulsing alpha value for fading effects
 * @param {number} time - Current time
 * @param {number} rate - Pulse rate
 * @param {number} minAlpha - Minimum alpha
 * @param {number} maxAlpha - Maximum alpha
 * @returns {number} Alpha value
 */
export function pulseAlpha(time, rate = 200, minAlpha = 0.6, maxAlpha = 1.0) {
    const range = maxAlpha - minAlpha;
    return minAlpha + range * Math.abs(Math.sin(time / rate));
}

/**
 * Calculate fade-out alpha based on remaining life
 * @param {number} currentLife - Current lifespan
 * @param {number} initialLife - Initial lifespan
 * @returns {number} Alpha value (0-1)
 */
export function fadeAlpha(currentLife, initialLife) {
    return Math.max(0, currentLife / initialLife);
}

/**
 * Determines if an entity should be visible based on remaining life (for blinking when dying)
 * @param {number} lifespan - Remaining lifespan
 * @param {number} blinkThreshold - When to start blinking
 * @param {number} time - Current time
 * @param {number} blinkSpeed - Blink speed in ms
 * @returns {boolean} Whether entity should be visible
 */
export function shouldBeVisible(lifespan, blinkThreshold = 3, time = Date.now(), blinkSpeed = 150) {
    if (lifespan > blinkThreshold) return true;
    return blink(time, blinkSpeed);
}
