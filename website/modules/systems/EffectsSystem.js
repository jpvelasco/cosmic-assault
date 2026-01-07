/**
 * Effects System
 * Handles visual effects like explosions, notifications, screen shake
 */

import { Particle, TextParticle, BlastRadiusParticle } from '../entities/Particle.js';
import { getComplementaryColor } from '../utils/color.js';
import { randomRange } from '../utils/math.js';
import { EFFECTS, NOTIFICATIONS, MAX_PARTICLES, POWERUP_COLORS } from '../core/constants.js';

/**
 * Visual effects management system
 */
export class EffectsSystem {
    constructor() {
        this.screenShake = 0;
    }

    /**
     * Update effects (screen shake decay)
     * @param {number} deltaTime
     */
    update(deltaTime) {
        if (this.screenShake > 0) {
            this.screenShake = Math.max(0, this.screenShake - deltaTime * 4);
        }
    }

    /**
     * Create a visual effect at a position
     * @param {string} type - Effect type from EFFECTS constant
     * @param {number} x
     * @param {number} y
     * @param {Array} particles - Particle array to add to
     * @param {Object} options - Override options
     * @returns {string|null} Sound to play
     */
    createEffect(type, x, y, particles, options = {}) {
        const effect = EFFECTS[type];
        if (!effect) return null;

        const size = options.size || effect.baseSize;
        const color = options.color || effect.color;
        const speed = options.speed || effect.speed;
        const shake = options.shake !== undefined ? options.shake : effect.shake;
        const sound = options.sound !== undefined ? options.sound : effect.sound;

        // Add screen shake
        this.screenShake = Math.min(1.0, this.screenShake + shake);

        // Create particles
        const particleCount = Math.min(
            Math.round(size * 0.8),
            MAX_PARTICLES - particles.length
        );

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const particleSpeed = speed * (0.5 + Math.random());
            const particleLife = 0.4 + Math.random() * 0.6;

            let particleColor = color;
            if (type === 'explosion' || type === 'shieldHit') {
                if (Math.random() < 0.3) particleColor = "#FFFFFF";
                else if (Math.random() < 0.2) particleColor = getComplementaryColor(color);
            }

            particles.push(new Particle(
                x, y,
                Math.cos(angle) * particleSpeed,
                Math.sin(angle) * particleSpeed,
                Math.random() * 2.5 + 1,
                particleColor,
                particleLife
            ));
        }

        return sound;
    }

    /**
     * Show a text notification
     * @param {string} type - Notification type from NOTIFICATIONS
     * @param {number} x
     * @param {number} y
     * @param {Array} particles - Particle array to add to
     * @param {...any} args - Arguments for the notification function
     */
    showNotification(type, x, y, particles, ...args) {
        const configGetter = NOTIFICATIONS[type];
        if (!configGetter) return;

        const config = configGetter(...args);
        if (!config) return;

        // Main text
        particles.push(new TextParticle(x, y, config.main, config.color, config.duration));

        // Sub text
        if (config.sub) {
            particles.push(new TextParticle(x, y + 25, config.sub, config.color, config.duration));
        }
    }

    /**
     * Create field bomb explosion effect
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @param {Array} particles
     */
    createFieldBombExplosion(x, y, radius, particles) {
        // Create expanding rings
        for (let i = 0; i < 4; i++) {
            particles.push(new BlastRadiusParticle(
                x, y, radius, i * 0.15, POWERUP_COLORS.fieldBomb
            ));
        }

        // Core explosion
        this.createEffect('fieldBomb', x, y, particles);
    }

    /**
     * Create high score celebration effect
     * @param {number} centerX
     * @param {number} centerY
     * @param {Array} particles
     */
    createHighScoreCelebration(centerX, centerY, particles) {
        const celebrationParticles = 50;

        for (let i = 0; i < celebrationParticles; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = randomRange(100, 250);
            const life = randomRange(1.5, 2.5);
            const color = `hsl(${Math.random() * 360}, 100%, 60%)`;

            particles.push(new Particle(
                centerX, centerY,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                randomRange(2, 5),
                color,
                life
            ));
        }
    }

    /**
     * Get current screen shake amount
     * @returns {number}
     */
    getScreenShake() {
        return this.screenShake;
    }

    /**
     * Set screen shake amount
     * @param {number} amount
     */
    setScreenShake(amount) {
        this.screenShake = Math.min(1.0, amount);
    }

    /**
     * Add to screen shake
     * @param {number} amount
     */
    addScreenShake(amount) {
        this.screenShake = Math.min(1.0, this.screenShake + amount);
    }

    /**
     * Reset effects
     */
    reset() {
        this.screenShake = 0;
    }
}
