/**
 * Spawning System
 * Handles spawning of all game entities
 */

import { Asteroid } from '../entities/Asteroid.js';
import { Powerup } from '../entities/Powerup.js';
import { GravityField } from '../entities/GravityField.js';
import { DangerZone } from '../entities/DangerZone.js';
import { BonusTarget } from '../entities/BonusTarget.js';
import { circleCollision, randomRange, randomChoice } from '../utils/math.js';
import {
    SHIP_SIZE,
    BASE_POWERUP_CHANCE,
    LEVEL_POWERUP_REDUCTION,
    MIN_POWERUP_CHANCE,
    TIMING
} from '../core/constants.js';

/**
 * Spawning system for game entities
 */
export class SpawningSystem {
    constructor() {
        this.asteroidSpawnTimer = 0;
    }

    /**
     * Handle all spawning logic for a frame
     * @param {number} deltaTime
     * @param {Object} gameState
     */
    update(deltaTime, gameState) {
        const {
            gameLevel,
            bonusRoundActive,
            player,
            asteroids,
            gravityFields,
            dangerZones,
            bonusTargets,
            width,
            height
        } = gameState;

        // Asteroid spawning (not during bonus round)
        if (!bonusRoundActive) {
            this._updateAsteroidSpawning(deltaTime, gameLevel, asteroids, player, width, height);
        }

        // Gravity field spawning (starts level 2)
        if (gameLevel >= 2) {
            this._updateGravityFieldSpawning(deltaTime, gameLevel, gravityFields, player, width, height);
        }

        // Danger zone spawning (starts level 5)
        if (gameLevel >= 5) {
            this._updateDangerZoneSpawning(deltaTime, gameLevel, dangerZones, width, height);
        }

        // Bonus target spawning (during bonus round)
        if (bonusRoundActive) {
            this._updateBonusTargetSpawning(deltaTime, gameLevel, bonusTargets, width, height);
        }
    }

    /**
     * Update asteroid spawning
     * @private
     */
    _updateAsteroidSpawning(deltaTime, gameLevel, asteroids, player, width, height) {
        this.asteroidSpawnTimer -= deltaTime;

        const currentSpawnInterval = Math.max(
            TIMING.minAsteroidSpawnInterval,
            TIMING.baseAsteroidSpawnInterval - (gameLevel - 1) * TIMING.levelSpawnReduction
        );

        if (this.asteroidSpawnTimer <= 0) {
            const asteroid = this.spawnAsteroid(gameLevel, player, width, height);
            asteroids.push(asteroid);
            this.asteroidSpawnTimer = currentSpawnInterval;
        }

        // Ensure minimum asteroids
        const minAsteroids = 2 + Math.floor(gameLevel * 1.2);
        if (asteroids.length < minAsteroids) {
            const asteroid = this.spawnAsteroid(gameLevel, player, width, height, true);
            asteroids.push(asteroid);
        }
    }

    /**
     * Update gravity field spawning
     * @private
     */
    _updateGravityFieldSpawning(deltaTime, gameLevel, gravityFields, player, width, height) {
        const spawnChance = (0.001 + (gameLevel - 2) * 0.0005) * (60 * deltaTime);
        if (gravityFields.length < 2 && Math.random() < spawnChance) {
            const field = this.spawnGravityField(gameLevel, player, width, height);
            gravityFields.push(field);
        }
    }

    /**
     * Update danger zone spawning
     * @private
     */
    _updateDangerZoneSpawning(deltaTime, gameLevel, dangerZones, width, height) {
        const spawnChance = (0.002 + (gameLevel - 5) * 0.0008) * (60 * deltaTime);
        if (dangerZones.length < 2 && Math.random() < spawnChance) {
            const zone = this.spawnDangerZone(width, height);
            dangerZones.push(zone);
        }
    }

    /**
     * Update bonus target spawning
     * @private
     */
    _updateBonusTargetSpawning(deltaTime, gameLevel, bonusTargets, width, height) {
        const maxTargets = 8 + gameLevel;
        if (bonusTargets.length < maxTargets && Math.random() < 0.1 * (60 * deltaTime)) {
            const target = this.spawnBonusTarget(width, height);
            bonusTargets.push(target);
        }
    }

    /**
     * Spawn an asteroid off-screen
     * @param {number} gameLevel
     * @param {Object} player
     * @param {number} width
     * @param {number} height
     * @param {boolean} awayFromPlayer
     * @returns {Asteroid}
     */
    spawnAsteroid(gameLevel, player, width, height, awayFromPlayer = false) {
        const edgeMargin = 100;
        let x, y;

        // Pick random edge
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
            case 0: x = Math.random() * width; y = -edgeMargin; break;
            case 1: x = width + edgeMargin; y = Math.random() * height; break;
            case 2: x = Math.random() * width; y = height + edgeMargin; break;
            case 3: x = -edgeMargin; y = Math.random() * height; break;
        }

        // Avoid spawning on player
        if (awayFromPlayer && player && circleCollision(x, y, 80, player.x, player.y, 150)) {
            switch (edge) {
                case 0: y = height + edgeMargin; break;
                case 1: x = -edgeMargin; break;
                case 2: y = -edgeMargin; break;
                case 3: x = width + edgeMargin; break;
            }
        }

        // Target direction
        const targetX = width * randomRange(0.3, 0.7);
        const targetY = height * randomRange(0.3, 0.7);
        const angle = Math.atan2(targetY - y, targetX - x) + randomRange(-0.4, 0.4);

        // Determine size
        let size = 3; // Tiny
        if (gameLevel >= 6 && Math.random() < 0.15) size = 0;
        else if (gameLevel >= 4 && Math.random() < 0.25) size = 1;
        else if (gameLevel >= 2 && Math.random() < 0.35) size = 2;

        const speedMultiplier = 1 + (gameLevel - 1) * 0.1;

        return new Asteroid(x, y, size, angle, speedMultiplier);
    }

    /**
     * Spawn a meteor (faster asteroid from top)
     * @param {number} width
     * @returns {Asteroid}
     */
    spawnMeteor(width) {
        const x = Math.random() * width;
        const y = -50;
        const angle = Math.PI / 2 + randomRange(-0.3, 0.3);
        const speedMultiplier = randomRange(1.5, 2.0);
        return new Asteroid(x, y, 3, angle, speedMultiplier, true);
    }

    /**
     * Spawn a powerup at location
     * @param {number} x
     * @param {number} y
     * @param {number} gameLevel
     * @returns {Powerup|null}
     */
    spawnPowerup(x, y, gameLevel) {
        const powerupChance = Math.max(
            MIN_POWERUP_CHANCE,
            BASE_POWERUP_CHANCE - (gameLevel - 1) * LEVEL_POWERUP_REDUCTION
        );

        if (Math.random() >= powerupChance) return null;

        let availableTypes = ["doubleShot", "rapidFire", "shield"];
        if (gameLevel >= 5 && Math.random() < 0.3) {
            availableTypes.push("fieldBomb");
        }

        const type = randomChoice(availableTypes);
        return new Powerup(x, y, type);
    }

    /**
     * Spawn a gravity field
     * @param {number} gameLevel
     * @param {Object} player
     * @param {number} width
     * @param {number} height
     * @returns {GravityField}
     */
    spawnGravityField(gameLevel, player, width, height) {
        const radius = randomRange(100, 250) + gameLevel * 5;
        const strength = (Math.random() > 0.5 ? 1 : -1) * (0.8 + gameLevel * 0.05);

        let x, y;
        for (let i = 0; i < 5; i++) {
            x = Math.random() * width;
            y = Math.random() * height;
            if (!player || !circleCollision(x, y, radius, player.x, player.y, SHIP_SIZE * 3)) {
                break;
            }
        }

        return new GravityField(x, y, radius, strength);
    }

    /**
     * Spawn a danger zone
     * @param {number} width
     * @param {number} height
     * @returns {DangerZone}
     */
    spawnDangerZone(width, height) {
        const zoneWidth = randomRange(100, 250);
        const zoneHeight = randomRange(100, 250);
        const x = Math.random() * (width - zoneWidth);
        const y = Math.random() * (height - zoneHeight);
        return new DangerZone(x, y, zoneWidth, zoneHeight);
    }

    /**
     * Spawn a bonus target
     * @param {number} width
     * @param {number} height
     * @returns {BonusTarget}
     */
    spawnBonusTarget(width, height) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const points = randomChoice([100, 200, 300]);
        return new BonusTarget(x, y, points);
    }

    /**
     * Reset spawn timer
     */
    reset() {
        this.asteroidSpawnTimer = 0;
    }
}
