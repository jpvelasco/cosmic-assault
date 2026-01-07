/**
 * Collision System
 * Handles all collision detection and response
 */

import { circleCollision } from '../utils/math.js';
import { SHIP_SIZE } from '../core/constants.js';

/**
 * Collision detection and handling system
 */
export class CollisionSystem {
    /**
     * @param {Object} callbacks - Collision response callbacks
     */
    constructor(callbacks = {}) {
        this.callbacks = {
            onPlayerHitAsteroid: callbacks.onPlayerHitAsteroid || (() => {}),
            onPlayerHitDangerZone: callbacks.onPlayerHitDangerZone || (() => {}),
            onPlayerCollectPowerup: callbacks.onPlayerCollectPowerup || (() => {}),
            onProjectileHitAsteroid: callbacks.onProjectileHitAsteroid || (() => {}),
            onProjectileHitBonusTarget: callbacks.onProjectileHitBonusTarget || (() => {})
        };
    }

    /**
     * Check all collisions
     * @param {Object} gameState
     */
    checkAll(gameState) {
        const { player, asteroids, projectiles, powerups, dangerZones, bonusTargets } = gameState;

        if (!player || !player.alive) return;

        // Player vs Asteroids
        if (!player.invulnerable) {
            this._checkPlayerAsteroidCollisions(player, asteroids);
        }

        // Player vs Danger Zones (shield doesn't protect)
        if (!player.invulnerable && !player.shielded) {
            this._checkPlayerDangerZoneCollisions(player, dangerZones);
        }

        // Player vs Powerups
        this._checkPlayerPowerupCollisions(player, powerups);

        // Projectiles vs Asteroids
        this._checkProjectileAsteroidCollisions(projectiles, asteroids);

        // Projectiles vs Bonus Targets
        if (gameState.bonusRoundActive) {
            this._checkProjectileBonusTargetCollisions(projectiles, bonusTargets);
        }
    }

    /**
     * Check player vs asteroid collisions
     * @param {Player} player
     * @param {Array} asteroids
     * @private
     */
    _checkPlayerAsteroidCollisions(player, asteroids) {
        for (let i = asteroids.length - 1; i >= 0; i--) {
            const asteroid = asteroids[i];
            if (circleCollision(
                player.x, player.y, SHIP_SIZE / 2,
                asteroid.x, asteroid.y, asteroid.radius
            )) {
                this.callbacks.onPlayerHitAsteroid(player, asteroid, i);
                break; // Only handle one collision per frame
            }
        }
    }

    /**
     * Check player vs danger zone collisions
     * @param {Player} player
     * @param {Array} dangerZones
     * @private
     */
    _checkPlayerDangerZoneCollisions(player, dangerZones) {
        for (let i = dangerZones.length - 1; i >= 0; i--) {
            const zone = dangerZones[i];
            if (zone.checkCollision(player)) {
                this.callbacks.onPlayerHitDangerZone(player, zone, i);
                break;
            }
        }
    }

    /**
     * Check player vs powerup collisions
     * @param {Player} player
     * @param {Array} powerups
     * @private
     */
    _checkPlayerPowerupCollisions(player, powerups) {
        for (let i = powerups.length - 1; i >= 0; i--) {
            const powerup = powerups[i];
            if (circleCollision(
                player.x, player.y, SHIP_SIZE / 2,
                powerup.x, powerup.y, powerup.radius
            )) {
                this.callbacks.onPlayerCollectPowerup(powerup, i);
            }
        }
    }

    /**
     * Check projectile vs asteroid collisions
     * @param {Array} projectiles
     * @param {Array} asteroids
     * @private
     */
    _checkProjectileAsteroidCollisions(projectiles, asteroids) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const projectile = projectiles[i];
            let hit = false;

            for (let j = asteroids.length - 1; j >= 0; j--) {
                const asteroid = asteroids[j];
                if (circleCollision(
                    projectile.x, projectile.y, projectile.radius,
                    asteroid.x, asteroid.y, asteroid.radius
                )) {
                    this.callbacks.onProjectileHitAsteroid(projectile, i, asteroid, j);
                    hit = true;
                }
            }

            if (hit) {
                // Remove projectile after all asteroid hits processed
                projectiles.splice(i, 1);
            }
        }
    }

    /**
     * Check projectile vs bonus target collisions
     * @param {Array} projectiles
     * @param {Array} bonusTargets
     * @private
     */
    _checkProjectileBonusTargetCollisions(projectiles, bonusTargets) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const projectile = projectiles[i];

            for (let j = bonusTargets.length - 1; j >= 0; j--) {
                const target = bonusTargets[j];
                if (circleCollision(
                    projectile.x, projectile.y, projectile.radius,
                    target.x, target.y, target.radius
                )) {
                    this.callbacks.onProjectileHitBonusTarget(projectile, i, target, j);
                    projectiles.splice(i, 1);
                    bonusTargets.splice(j, 1);
                    break; // Projectile is gone
                }
            }
        }
    }
}
