/**
 * Game State Module
 * Centralized game state management
 */

import { LEVEL_THRESHOLDS, WEAPON_UPGRADE_THRESHOLDS } from './constants.js';

/**
 * Game state container - holds all mutable game state
 */
export class GameState {
    constructor() {
        this.reset();
    }

    /**
     * Reset all state to initial values
     */
    reset() {
        // Game flow
        this.gameState = 'title'; // 'title', 'playing', 'gameOver', 'paused'
        this.previousGameState = null;

        // Score and progression
        this.score = 0;
        this.scoreDisplay = 0; // Animated score display
        this.highScore = 0;
        this.lives = 3;
        this.gameLevel = 1;
        this.scoreMultiplier = 1;
        this.weaponLevel = 1;

        // Entity arrays
        this.player = null;
        this.asteroids = [];
        this.projectiles = [];
        this.particles = [];
        this.powerups = [];
        this.gravityFields = [];
        this.dangerZones = [];
        this.bonusTargets = [];
        this.stars = [];

        // Events
        this.meteorShowerActive = false;
        this.meteorShowerTimer = 0;
        this.meteorShowerDuration = 0;
        this.bonusRoundActive = false;
        this.bonusRoundTimer = 0;
        this.bonusRoundDuration = 0;
        this.bonusMultiplier = 2;

        // Powerup state
        this.activePowerups = {};
        this.powerupTimers = {};

        // Screen dimensions
        this.width = 0;
        this.height = 0;
    }

    /**
     * Set screen dimensions
     * @param {number} width
     * @param {number} height
     */
    setDimensions(width, height) {
        this.width = width;
        this.height = height;
    }

    /**
     * Add score with multipliers
     * @param {number} baseScore
     * @returns {number} Actual score added
     */
    addScore(baseScore) {
        const multipliedScore = Math.floor(
            baseScore * this.scoreMultiplier * (this.bonusRoundActive ? this.bonusMultiplier : 1)
        );
        this.score += multipliedScore;
        return multipliedScore;
    }

    /**
     * Update animated score display
     * @param {number} deltaTime
     */
    updateScoreDisplay(deltaTime) {
        if (this.scoreDisplay < this.score) {
            this.scoreDisplay = Math.min(
                this.score,
                this.scoreDisplay + Math.ceil((this.score - this.scoreDisplay) * deltaTime * 8)
            );
        } else if (this.scoreDisplay > this.score) {
            this.scoreDisplay = this.score;
        }
    }

    /**
     * Check and apply level progression
     * @returns {boolean} True if level changed
     */
    checkLevelProgression() {
        if (this.gameLevel < LEVEL_THRESHOLDS.length - 1) {
            const nextThreshold = LEVEL_THRESHOLDS[this.gameLevel];
            if (this.score >= nextThreshold) {
                this.gameLevel++;
                this.scoreMultiplier = 1 + (this.gameLevel - 1) * 0.4;
                return true;
            }
        }
        return false;
    }

    /**
     * Check and apply weapon upgrades
     * @returns {number|null} New weapon level if upgraded, null otherwise
     */
    checkWeaponUpgrade() {
        if (this.weaponLevel < 3) {
            const threshold = WEAPON_UPGRADE_THRESHOLDS[this.weaponLevel + 1];
            if (this.score >= threshold) {
                this.weaponLevel++;
                return this.weaponLevel;
            }
        }
        return null;
    }

    /**
     * Lose a life
     * @returns {boolean} True if game over
     */
    loseLife() {
        this.lives--;
        return this.lives <= 0;
    }

    /**
     * Activate a powerup
     * @param {string} type
     * @param {number} duration
     */
    activatePowerup(type, duration) {
        this.activePowerups[type] = true;
        this.powerupTimers[type] = duration;
    }

    /**
     * Deactivate a powerup
     * @param {string} type
     */
    deactivatePowerup(type) {
        this.activePowerups[type] = false;
        this.powerupTimers[type] = 0;
    }

    /**
     * Update powerup timers
     * @param {number} deltaTime
     * @returns {Array} List of expired powerup types
     */
    updatePowerupTimers(deltaTime) {
        const expired = [];
        for (const type in this.powerupTimers) {
            if (this.activePowerups[type] && this.powerupTimers[type] > 0) {
                this.powerupTimers[type] -= deltaTime;
                if (this.powerupTimers[type] <= 0) {
                    this.activePowerups[type] = false;
                    expired.push(type);
                }
            }
        }
        return expired;
    }

    /**
     * Start meteor shower event
     * @param {number} duration
     */
    startMeteorShower(duration) {
        this.meteorShowerActive = true;
        this.meteorShowerDuration = duration;
        this.meteorShowerTimer = duration;
    }

    /**
     * End meteor shower
     */
    endMeteorShower() {
        this.meteorShowerActive = false;
    }

    /**
     * Start bonus round
     * @param {number} duration
     * @param {number} multiplier
     */
    startBonusRound(duration, multiplier) {
        this.bonusRoundActive = true;
        this.bonusRoundDuration = duration;
        this.bonusRoundTimer = duration;
        this.bonusMultiplier = multiplier;
    }

    /**
     * End bonus round
     */
    endBonusRound() {
        this.bonusRoundActive = false;
        this.bonusTargets = [];
    }

    /**
     * Update event timers
     * @param {number} deltaTime
     * @returns {Object} Events that ended
     */
    updateEventTimers(deltaTime) {
        const ended = { meteorShower: false, bonusRound: false };

        if (this.meteorShowerActive) {
            this.meteorShowerTimer -= deltaTime;
            if (this.meteorShowerTimer <= 0) {
                this.endMeteorShower();
                ended.meteorShower = true;
            }
        }

        if (this.bonusRoundActive) {
            this.bonusRoundTimer -= deltaTime;
            if (this.bonusRoundTimer <= 0) {
                this.endBonusRound();
                ended.bonusRound = true;
            }
        }

        return ended;
    }

    /**
     * Check if high score was beaten
     * @returns {boolean}
     */
    checkHighScore() {
        if (this.score > this.highScore) {
            this.highScore = this.score;
            return true;
        }
        return false;
    }

    /**
     * Load high score from localStorage
     */
    loadHighScore() {
        try {
            const saved = localStorage.getItem('cosmicAssaultHighScore');
            this.highScore = parseInt(saved, 10) || 0;
        } catch (e) {
            console.warn("Could not load high score:", e);
            this.highScore = 0;
        }
    }

    /**
     * Save high score to localStorage
     */
    saveHighScore() {
        try {
            localStorage.setItem('cosmicAssaultHighScore', this.highScore.toString());
        } catch (e) {
            console.warn("Could not save high score:", e);
        }
    }

    /**
     * Get state snapshot for test API
     * @returns {Object}
     */
    getSnapshot() {
        return {
            gameState: this.gameState,
            score: this.score,
            lives: this.lives,
            gameLevel: this.gameLevel,
            scoreMultiplier: this.scoreMultiplier,
            weaponLevel: this.weaponLevel,
            highScore: this.highScore,
            meteorShowerActive: this.meteorShowerActive,
            bonusRoundActive: this.bonusRoundActive,
            isMobileControlsActive: false, // Set by Game class
            activePowerups: { ...this.activePowerups },
            powerupTimers: { ...this.powerupTimers }
        };
    }

    /**
     * Get entity counts for test API
     * @returns {Object}
     */
    getEntityCounts() {
        return {
            asteroids: this.asteroids.length,
            projectiles: this.projectiles.length,
            particles: this.particles.length,
            powerups: this.powerups.length,
            gravityFields: this.gravityFields.length,
            dangerZones: this.dangerZones.length,
            bonusTargets: this.bonusTargets.length
        };
    }
}
