/**
 * Main Game Class
 * Coordinates all game systems and manages the game loop
 */

import { GameState } from './GameState.js';
import {
    SHIP_SIZE,
    SHIP_COLOR,
    ASTEROID_COLOR,
    TEXT_COLOR,
    DEFAULT_FONT,
    POWERUP_TYPES,
    POWERUP_CONFIG,
    ASTEROID_SCORES,
    TIMING,
    LEVEL_THRESHOLDS,
    TEST_MODE
} from './constants.js';

import { Player } from '../entities/Player.js';
import { Asteroid } from '../entities/Asteroid.js';
import { Projectile } from '../entities/Projectile.js';
import { Particle } from '../entities/Particle.js';

import { CollisionSystem } from '../systems/CollisionSystem.js';
import { SpawningSystem } from '../systems/SpawningSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { InputSystem } from '../systems/InputSystem.js';
import { EffectsSystem } from '../systems/EffectsSystem.js';

import { hexToRgb } from '../utils/color.js';
import { randomRange } from '../utils/math.js';

/**
 * Check if running on mobile device
 */
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Main Game controller class
 */
export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // State
        this.state = new GameState();
        this.lastTime = 0;

        // Systems
        this.audio = new AudioSystem();
        this.input = new InputSystem();
        this.effects = new EffectsSystem();
        this.spawning = new SpawningSystem();
        this.collision = new CollisionSystem({
            onPlayerHitAsteroid: (player, asteroid, index) => this._handlePlayerAsteroidCollision(player, asteroid, index),
            onPlayerHitDangerZone: (player, zone, index) => this._handlePlayerDangerZoneCollision(player, zone, index),
            onPlayerCollectPowerup: (powerup, index) => this._handlePowerupCollect(powerup, index),
            onProjectileHitAsteroid: (proj, projIndex, asteroid, astIndex) => this._handleProjectileAsteroidCollision(proj, projIndex, asteroid, astIndex),
            onProjectileHitBonusTarget: (proj, projIndex, target, targetIndex) => this._handleProjectileBonusTargetCollision(proj, projIndex, target, targetIndex)
        });

        // Mobile detection
        this.isMobile = isMobileDevice() || TEST_MODE;
    }

    /**
     * Initialize the game
     */
    initialize() {
        // Load saved data
        this.state.loadHighScore();

        // Set up canvas
        this._resizeCanvas();
        this._createStars();

        // Initialize systems
        this.audio.initialize();
        this.input.initialize({
            isMobile: this.isMobile,
            testMode: TEST_MODE,
            canvas: this.canvas,
            onStartGame: () => this._handleStartInput(),
            onRestartGame: () => this._handleRestartInput()
        });

        // Event listeners
        window.addEventListener('resize', () => this._handleResize());
        window.addEventListener('orientationchange', () => this._handleOrientationChange());

        // Show/hide mobile controls
        const mobileControlsEl = document.querySelector('.mobile-controls');
        if (mobileControlsEl) {
            mobileControlsEl.style.display = this.isMobile ? 'block' : 'none';
        }

        // Expose test API
        this._exposeTestAPI();
    }

    /**
     * Start the game loop
     */
    start() {
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._gameLoop(t));
    }

    /**
     * Main game loop
     * @param {number} timestamp
     * @private
     */
    _gameLoop(timestamp) {
        let deltaTime = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        deltaTime = Math.min(deltaTime, 0.1); // Cap delta time

        if (this.state.gameState !== 'paused') {
            this._update(deltaTime);
        }
        this._render();

        requestAnimationFrame((t) => this._gameLoop(t));
    }

    /**
     * Update game state
     * @param {number} deltaTime
     * @private
     */
    _update(deltaTime) {
        if (this.state.gameState !== 'playing') return;

        // Update player
        const inputState = this.input.getState();
        this.state.player.update(
            deltaTime,
            inputState,
            this.state.width,
            this.state.height,
            (data) => this._createProjectiles(data),
            (x, y, vx, vy, size, color, life) => this._createParticle(x, y, vx, vy, size, color, life)
        );

        // Update score display
        this.state.updateScoreDisplay(deltaTime);

        // Update entities
        this._updateEntities(deltaTime);

        // Apply gravity fields
        this._applyGravityFields(deltaTime);

        // Check collisions
        this.collision.checkAll(this.state);

        // Update powerups
        this._updatePowerups(deltaTime);

        // Handle spawning
        this.spawning.update(deltaTime, {
            gameLevel: this.state.gameLevel,
            bonusRoundActive: this.state.bonusRoundActive,
            player: this.state.player,
            asteroids: this.state.asteroids,
            gravityFields: this.state.gravityFields,
            dangerZones: this.state.dangerZones,
            bonusTargets: this.state.bonusTargets,
            width: this.state.width,
            height: this.state.height
        });

        // Handle game events
        this._handleGameEvents(deltaTime);

        // Check progression
        this._checkProgression();

        // Update effects
        this.effects.update(deltaTime);
    }

    /**
     * Update all entities
     * @param {number} deltaTime
     * @private
     */
    _updateEntities(deltaTime) {
        const { width, height } = this.state;

        // Update and clean up entities
        const entityArrays = [
            this.state.projectiles,
            this.state.asteroids,
            this.state.particles,
            this.state.powerups,
            this.state.gravityFields,
            this.state.dangerZones,
            this.state.bonusTargets
        ];

        entityArrays.forEach(arr => {
            for (let i = arr.length - 1; i >= 0; i--) {
                const entity = arr[i];

                // Update with appropriate parameters
                if (entity.update.length === 1) {
                    entity.update(deltaTime);
                } else if (entity.update.length === 3) {
                    entity.update(deltaTime, width, height);
                } else if (entity.update.length === 4) {
                    // Asteroids with particle callback
                    entity.update(deltaTime, width, height, (x, y, vx, vy, size, color, life) =>
                        this._createParticle(x, y, vx, vy, size, color, life)
                    );
                }

                // Remove inactive or expired entities
                if ((entity.lifespan !== undefined && entity.lifespan <= 0) ||
                    (entity.active !== undefined && !entity.active)) {
                    arr.splice(i, 1);
                }
            }
        });
    }

    /**
     * Apply gravity fields to entities
     * @param {number} deltaTime
     * @private
     */
    _applyGravityFields(deltaTime) {
        this.state.gravityFields.forEach(field => {
            if (this.state.player && this.state.player.alive) {
                field.applyGravity(this.state.player, deltaTime);
            }
            this.state.projectiles.forEach(p => field.applyGravity(p, deltaTime));
            this.state.asteroids.forEach(a => field.applyGravity(a, deltaTime));
        });
    }

    /**
     * Render the game
     * @private
     */
    _render() {
        const { ctx, state } = this;
        const { width, height } = state;

        ctx.clearRect(0, 0, width, height);

        // Apply screen shake
        const shake = this.effects.getScreenShake();
        if (shake > 0 && state.gameState === 'playing') {
            ctx.save();
            const shakeX = (Math.random() - 0.5) * shake * 15;
            const shakeY = (Math.random() - 0.5) * shake * 15;
            ctx.translate(shakeX, shakeY);
        }

        // Draw stars
        this._drawStars();

        // Draw based on game state
        if (state.gameState === 'title') {
            this._drawTitleScreen();
        } else if (state.gameState === 'playing') {
            this._drawGameplay();
            this._drawHUD();
        } else if (state.gameState === 'gameOver') {
            this._drawGameOverScreen();
        }

        // Restore after screen shake
        if (shake > 0 && state.gameState === 'playing') {
            ctx.restore();
        }
    }

    /**
     * Draw stars background
     * @private
     */
    _drawStars() {
        const { ctx, state } = this;
        state.stars.forEach(star => {
            ctx.fillStyle = star.color;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    /**
     * Draw gameplay elements
     * @private
     */
    _drawGameplay() {
        const { ctx, state } = this;

        // Draw in order: zones -> fields -> asteroids -> powerups -> targets -> player -> projectiles -> particles
        state.dangerZones.forEach(z => z.draw(ctx));
        state.gravityFields.forEach(f => f.draw(ctx));
        state.asteroids.forEach(a => a.draw(ctx));
        state.powerups.forEach(p => p.draw(ctx));
        state.bonusTargets.forEach(t => t.draw(ctx));

        if (state.player && state.player.alive) {
            state.player.draw(ctx);
        }

        state.projectiles.forEach(p => p.draw(ctx));
        state.particles.forEach(p => p.draw(ctx));
    }

    /**
     * Draw HUD
     * @private
     */
    _drawHUD() {
        const { ctx, state } = this;
        const { width, height } = state;

        ctx.save();
        ctx.font = `20px ${DEFAULT_FONT}`;
        ctx.textBaseline = "top";

        // Score (top left)
        ctx.textAlign = "left";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(`SCORE: ${Math.floor(state.scoreDisplay)}`, 20, 60);
        ctx.fillStyle = "#FFFF00";
        ctx.fillText(`HIGH: ${state.highScore}`, 20, 85);

        // Level (top center)
        ctx.textAlign = "center";
        ctx.fillStyle = TEXT_COLOR;
        ctx.fillText(`LEVEL ${state.gameLevel}`, width / 2, 20);
        ctx.fillStyle = "#FF00FF";
        ctx.fillText(`MULT: ${state.scoreMultiplier.toFixed(1)}x`, width / 2, 45);

        // Lives (top right)
        ctx.textAlign = "right";
        if (state.lives === 1) {
            const pulse = 0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 200));
            ctx.fillStyle = `rgba(255, 0, 0, ${pulse})`;
        } else {
            ctx.fillStyle = "#FFFFFF";
        }
        ctx.fillText(`LIVES: ${state.lives}`, width - 20, 85);

        // Draw ship icons for lives
        this._drawLifeIcons(width - 20, 65, state.lives);

        // Active powerups (bottom center)
        this._drawActivePowerups(width / 2, height - 30);

        // Bonus round timer
        if (state.bonusRoundActive) {
            ctx.font = `bold 20px ${DEFAULT_FONT}`;
            ctx.fillStyle = "#FFFF00";
            ctx.shadowColor = "#FFFF00";
            ctx.shadowBlur = 10;
            ctx.textAlign = "center";
            ctx.fillText(`BONUS: ${Math.ceil(state.bonusRoundTimer)}s`, width / 2, 70);
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    }

    /**
     * Draw life icons
     * @param {number} x
     * @param {number} y
     * @param {number} count
     * @private
     */
    _drawLifeIcons(x, y, count) {
        const { ctx } = this;
        ctx.strokeStyle = SHIP_COLOR;
        ctx.lineWidth = 1.5;
        const size = 10;
        const spacing = size * 1.8;

        ctx.save();
        ctx.translate(x, y);

        for (let i = 0; i < count; i++) {
            ctx.beginPath();
            ctx.moveTo(size * 0.8, 0);
            ctx.lineTo(-size * 0.5, -size * 0.5);
            ctx.lineTo(-size * 0.3, 0);
            ctx.lineTo(-size * 0.5, size * 0.5);
            ctx.closePath();
            ctx.stroke();
            ctx.translate(-spacing, 0);
        }

        ctx.restore();
    }

    /**
     * Draw active powerups
     * @param {number} x
     * @param {number} y
     * @private
     */
    _drawActivePowerups(x, y) {
        const { ctx, state } = this;
        ctx.textAlign = "center";
        ctx.font = `16px ${DEFAULT_FONT}`;
        let count = 0;

        POWERUP_TYPES.forEach(type => {
            if (state.activePowerups[type] && state.powerupTimers[type] > 0) {
                const config = POWERUP_CONFIG[type];
                if (!config || config.duration <= 0) return;

                const remainingTime = Math.ceil(state.powerupTimers[type]);
                const text = type.replace(/([A-Z])/g, ' $1').toUpperCase();

                if (remainingTime <= 3) {
                    const pulse = 0.7 + 0.3 * Math.abs(Math.sin(Date.now() / 150));
                    ctx.fillStyle = `rgba(${hexToRgb(config.color)}, ${pulse})`;
                } else {
                    ctx.fillStyle = config.color;
                }

                ctx.fillText(`${text}: ${remainingTime}s`, x, y - count * 20);
                count++;
            }
        });
    }

    /**
     * Draw title screen
     * @private
     */
    _drawTitleScreen() {
        const { ctx, state } = this;
        const { width, height } = state;

        ctx.save();
        ctx.textAlign = "center";
        ctx.fillStyle = TEXT_COLOR;

        // Title
        ctx.font = `bold 60px ${DEFAULT_FONT}`;
        ctx.shadowColor = TEXT_COLOR;
        ctx.shadowBlur = 15;
        ctx.fillText("COSMIC ASSAULT", width / 2, height * 0.3);
        ctx.fillText("COSMIC ASSAULT", width / 2, height * 0.3);
        ctx.shadowBlur = 0;

        // Instructions
        ctx.font = `20px ${DEFAULT_FONT}`;
        const instructionY = height * 0.5;
        if (this.isMobile) {
            ctx.fillText("Use Joystick to Move & Aim", width / 2, instructionY);
            ctx.fillText("Press FIRE Button to Shoot", width / 2, instructionY + 30);
        } else {
            ctx.fillText("Arrow Keys to Move & Aim", width / 2, instructionY);
            ctx.fillText("Spacebar to Shoot", width / 2, instructionY + 30);
        }
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText("Destroy Asteroids - Collect Powerups", width / 2, instructionY + 60);

        // High score
        ctx.font = `24px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FFFF00";
        ctx.fillText(`HIGH SCORE: ${state.highScore}`, width / 2, instructionY + 110);

        // Start prompt
        ctx.font = `28px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FFFFFF";
        const promptText = this.isMobile ? "TAP SCREEN TO START" : "PRESS ANY KEY TO START";
        if (Math.floor(Date.now() / 500) % 2 === 0) {
            ctx.fillText(promptText, width / 2, height * 0.8);
        }

        ctx.restore();
    }

    /**
     * Draw game over screen
     * @private
     */
    _drawGameOverScreen() {
        const { ctx, state } = this;
        const { width, height } = state;

        // Draw remaining entities
        state.asteroids.forEach(a => a.draw(ctx));
        state.particles.forEach(p => p.draw(ctx));

        ctx.save();
        ctx.textAlign = "center";

        // Game over text
        ctx.font = `bold 70px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FF0000";
        ctx.shadowColor = "#FF0000";
        ctx.shadowBlur = 20;
        ctx.fillText("GAME OVER", width / 2, height * 0.3);
        ctx.fillText("GAME OVER", width / 2, height * 0.3);
        ctx.shadowBlur = 0;

        // Score
        ctx.font = `30px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(`FINAL SCORE: ${state.score}`, width / 2, height * 0.5);

        // High score
        ctx.font = `24px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FFFF00";
        ctx.fillText(`HIGH SCORE: ${state.highScore}`, width / 2, height * 0.5 + 45);

        // New high score message
        if (state.score === state.highScore && state.score > 0) {
            ctx.font = `bold 28px ${DEFAULT_FONT}`;
            ctx.fillStyle = "#FF00FF";
            ctx.shadowColor = "#FF00FF";
            ctx.shadowBlur = 10;
            ctx.fillText("NEW HIGH SCORE!", width / 2, height * 0.5 + 90);
            ctx.shadowBlur = 0;
        }

        // Restart prompt
        ctx.font = `28px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FFFFFF";
        const promptText = this.isMobile ? "TAP RESTART BUTTON" : "PRESS 'R' TO RESTART";
        if (Math.floor(Date.now() / 500) % 2 === 0) {
            ctx.fillText(promptText, width / 2, height * 0.8);
        }

        ctx.restore();

        // Show restart button on mobile
        const restartBtn = document.getElementById('restart-button');
        if (restartBtn && this.isMobile) {
            restartBtn.style.display = 'block';
        }
    }

    // ... Collision handlers and other methods continue in next part
    // Due to file size, splitting into logical sections

    /**
     * Handle player-asteroid collision
     * @private
     */
    _handlePlayerAsteroidCollision(player, asteroid, index) {
        if (player.shielded) {
            player.shielded = false;
            this.state.activePowerups.shield = false;
            this.state.powerupTimers.shield = 0;
            const sound = this.effects.createEffect('shieldHit', player.x, player.y, this.state.particles, { size: asteroid.radius });
            if (sound) this.audio.play(sound);
            this._breakAsteroid(index);
        } else {
            this._playerHit();
            this.effects.createEffect('explosion', player.x, player.y, this.state.particles, { size: 30, color: SHIP_COLOR });
            this._breakAsteroid(index);
        }
    }

    /**
     * Handle player-danger zone collision
     * @private
     */
    _handlePlayerDangerZoneCollision(player, zone, index) {
        this._playerHit();
        this.effects.showNotification('dangerZone', player.x, player.y - 30, this.state.particles);
        this.effects.createEffect('explosion', player.x, player.y, this.state.particles, { size: 15, color: '#FF0000', shake: 0.1 });
    }

    /**
     * Handle powerup collection
     * @private
     */
    _handlePowerupCollect(powerup, index) {
        this._activatePowerup(powerup.type);
        this.state.powerups.splice(index, 1);
    }

    /**
     * Handle projectile-asteroid collision
     * @private
     */
    _handleProjectileAsteroidCollision(proj, projIndex, asteroid, astIndex) {
        const points = ASTEROID_SCORES[asteroid.size] || 10;
        this.state.addScore(points);
        const sound = this.effects.createEffect('explosion', asteroid.x, asteroid.y, this.state.particles, { size: asteroid.radius });
        if (sound) this.audio.play(sound);
        this._breakAsteroid(astIndex);
    }

    /**
     * Handle projectile-bonus target collision
     * @private
     */
    _handleProjectileBonusTargetCollision(proj, projIndex, target, targetIndex) {
        const points = target.points * this.state.bonusMultiplier;
        this.state.score += points;
        this.effects.showNotification('bonusPoints', target.x, target.y - 20, this.state.particles, points);
        this.effects.createEffect('powerup', target.x, target.y, this.state.particles);
    }

    /**
     * Handle player taking damage
     * @private
     */
    _playerHit() {
        if (this.state.player.invulnerable) return;

        this.effects.addScreenShake(0.8);
        const isGameOver = this.state.loseLife();

        if (isGameOver) {
            this.state.player.alive = false;
            this.state.gameState = 'gameOver';
            this.audio.play('gameover');
            this.state.checkHighScore();
            this.state.saveHighScore();
        } else {
            this.state.player.respawn(this.state.width, this.state.height);
            this.audio.play('explosion');
        }
    }

    /**
     * Break an asteroid
     * @param {number} index
     * @private
     */
    _breakAsteroid(index) {
        const asteroid = this.state.asteroids[index];
        if (!asteroid) return;

        // Spawn smaller asteroids
        if (asteroid.canBreak()) {
            const childSize = asteroid.getChildSize();
            for (let i = 0; i < 2; i++) {
                const angleOffset = (Math.random() - 0.5) * 1.5;
                const speedBoost = 1 + Math.random() * 0.3;
                this.state.asteroids.push(new Asteroid(
                    asteroid.x, asteroid.y,
                    childSize,
                    asteroid.rotation + angleOffset,
                    speedBoost,
                    asteroid.isMeteor
                ));
            }
        }

        // Spawn powerup
        const powerup = this.spawning.spawnPowerup(asteroid.x, asteroid.y, this.state.gameLevel);
        if (powerup) {
            this.state.powerups.push(powerup);
        }

        this.state.asteroids.splice(index, 1);
    }

    /**
     * Activate a powerup
     * @param {string} type
     * @private
     */
    _activatePowerup(type) {
        const config = POWERUP_CONFIG[type];
        if (!config) return;

        this.audio.play('powerup');
        this.effects.showNotification('powerupCollected', this.state.player.x, this.state.player.y - 30, this.state.particles, type);

        // Field bomb is instant
        if (type === 'fieldBomb') {
            this._createFieldBombExplosion();
            return;
        }

        // Timed powerups
        this.state.activatePowerup(type, config.duration);

        switch (type) {
            case 'doubleShot':
                this.state.player.setWeaponCountMultiplier(2);
                break;
            case 'rapidFire':
                this.state.player.setFireRateMultiplier(2);
                break;
            case 'shield':
                this.state.player.activateShield();
                break;
        }

        this.effects.createEffect('powerup', this.state.player.x, this.state.player.y, this.state.particles, { color: config.color });
    }

    /**
     * Update powerup timers
     * @param {number} deltaTime
     * @private
     */
    _updatePowerups(deltaTime) {
        const expired = this.state.updatePowerupTimers(deltaTime);
        expired.forEach(type => {
            switch (type) {
                case 'doubleShot':
                    this.state.player.setWeaponCountMultiplier(1);
                    break;
                case 'rapidFire':
                    this.state.player.setFireRateMultiplier(1);
                    break;
                case 'shield':
                    this.state.player.deactivateShield();
                    break;
            }
        });
    }

    /**
     * Create field bomb explosion
     * @private
     */
    _createFieldBombExplosion() {
        const { player } = this.state;
        if (!player) return;

        const radius = 250 + this.state.weaponLevel * 25;
        this.effects.createFieldBombExplosion(player.x, player.y, radius, this.state.particles);
        this.effects.showNotification('fieldBombDetonation', player.x, player.y - 50, this.state.particles);
        this.audio.play('nuke');

        // Destroy asteroids in radius
        let pointsEarned = 0;
        for (let i = this.state.asteroids.length - 1; i >= 0; i--) {
            const asteroid = this.state.asteroids[i];
            const dx = asteroid.x - player.x;
            const dy = asteroid.y - player.y;
            const distSq = dx * dx + dy * dy;
            const radiusSq = (radius + asteroid.radius) ** 2;

            if (distSq < radiusSq) {
                pointsEarned += ASTEROID_SCORES[asteroid.size] || 10;
                this.effects.createEffect('explosion', asteroid.x, asteroid.y, this.state.particles, { size: asteroid.radius });
                this.state.asteroids.splice(i, 1);
            }
        }

        this.state.addScore(pointsEarned);
    }

    /**
     * Create projectiles from player shooting
     * @param {Object} data
     * @private
     */
    _createProjectiles(data) {
        const { x, y, angle, baseVx, baseVy, speed, weaponMultiplier } = data;
        const effectiveLevel = this.state.weaponLevel * weaponMultiplier;

        this.audio.play('shoot');

        if (effectiveLevel === 1) {
            this.state.projectiles.push(new Projectile(
                x, y,
                baseVx + Math.cos(angle) * speed,
                baseVy + Math.sin(angle) * speed
            ));
        } else if (effectiveLevel === 2) {
            const spread = 0.12;
            this.state.projectiles.push(new Projectile(x, y, baseVx + Math.cos(angle - spread) * speed, baseVy + Math.sin(angle - spread) * speed));
            this.state.projectiles.push(new Projectile(x, y, baseVx + Math.cos(angle + spread) * speed, baseVy + Math.sin(angle + spread) * speed));
        } else {
            const spread = 0.18;
            this.state.projectiles.push(new Projectile(x, y, baseVx + Math.cos(angle) * speed, baseVy + Math.sin(angle) * speed));
            this.state.projectiles.push(new Projectile(x, y, baseVx + Math.cos(angle - spread) * speed, baseVy + Math.sin(angle - spread) * speed));
            this.state.projectiles.push(new Projectile(x, y, baseVx + Math.cos(angle + spread) * speed, baseVy + Math.sin(angle + spread) * speed));
            if (effectiveLevel >= 4) {
                const widerSpread = 0.3;
                this.state.projectiles.push(new Projectile(x, y, baseVx + Math.cos(angle - widerSpread) * speed, baseVy + Math.sin(angle - widerSpread) * speed));
                this.state.projectiles.push(new Projectile(x, y, baseVx + Math.cos(angle + widerSpread) * speed, baseVy + Math.sin(angle + widerSpread) * speed));
            }
        }
    }

    /**
     * Create a particle
     * @private
     */
    _createParticle(x, y, vx, vy, size, color, life) {
        this.state.particles.push(new Particle(x, y, vx, vy, size, color, life));
    }

    /**
     * Handle game events (meteor shower, bonus round)
     * @param {number} deltaTime
     * @private
     */
    _handleGameEvents(deltaTime) {
        const { state } = this;

        // Meteor shower
        if (state.meteorShowerActive) {
            const spawnChance = (5 + state.gameLevel) * deltaTime;
            if (Math.random() < spawnChance) {
                state.asteroids.push(this.spawning.spawnMeteor(state.width));
            }
        } else if (state.gameLevel >= 3) {
            const triggerChance = (0.0005 + (state.gameLevel - 3) * 0.0002) * (60 * deltaTime);
            if (Math.random() < triggerChance && !state.bonusRoundActive) {
                this._triggerMeteorShower();
            }
        }

        // Bonus round
        if (!state.bonusRoundActive && !state.meteorShowerActive && state.gameLevel >= 4) {
            const triggerChance = (0.0003 + (state.gameLevel - 4) * 0.0001) * (60 * deltaTime);
            if (Math.random() < triggerChance) {
                this._triggerBonusRound();
            }
        }

        // Update event timers
        const ended = state.updateEventTimers(deltaTime);
        if (ended.meteorShower) {
            this.effects.showNotification('meteorShowerEnded', state.width / 2, state.height / 2, state.particles);
        }
        if (ended.bonusRound) {
            this.effects.showNotification('bonusRoundEnded', state.width / 2, state.height / 2, state.particles);
            // Spawn asteroids after bonus
            const postBonusCount = 2 + Math.floor(state.gameLevel / 2);
            for (let i = 0; i < postBonusCount; i++) {
                state.asteroids.push(this.spawning.spawnAsteroid(state.gameLevel, state.player, state.width, state.height, true));
            }
        }
    }

    /**
     * Trigger meteor shower
     * @private
     */
    _triggerMeteorShower() {
        const duration = 8 + this.state.gameLevel * 1.5;
        this.state.startMeteorShower(duration);
        this.effects.showNotification('meteorShowerIncoming', this.state.width / 2, this.state.height / 2, this.state.particles);
        this.audio.play('levelup');
        this.effects.addScreenShake(0.5);
    }

    /**
     * Trigger bonus round
     * @private
     */
    _triggerBonusRound() {
        const multiplier = 2 + Math.floor(this.state.gameLevel / 2);
        this.state.startBonusRound(15, multiplier);
        this.effects.showNotification('bonusRound', this.state.width / 2, this.state.height / 2, this.state.particles, multiplier);
        this.audio.play('levelup');
        this.effects.addScreenShake(0.7);

        // Initial targets
        for (let i = 0; i < 5 + this.state.gameLevel; i++) {
            this.state.bonusTargets.push(this.spawning.spawnBonusTarget(this.state.width, this.state.height));
        }
    }

    /**
     * Check game progression
     * @private
     */
    _checkProgression() {
        if (this.state.checkLevelProgression()) {
            this.effects.showNotification('levelUp', this.state.width / 2, 60, this.state.particles, this.state.gameLevel, this.state.scoreMultiplier);
            this.audio.play('levelup');
            this.effects.addScreenShake(0.6);
        }

        const newWeaponLevel = this.state.checkWeaponUpgrade();
        if (newWeaponLevel) {
            this.effects.showNotification('weaponUpgrade', this.state.width / 2, this.state.height / 2, this.state.particles, newWeaponLevel);
            this.audio.play('powerup');
        }
    }

    /**
     * Start a new game
     * @private
     */
    _startGame() {
        this.state.reset();
        this.state.gameState = 'playing';
        this.state.setDimensions(this.canvas.width, this.canvas.height);
        this.state.loadHighScore();

        // Create player
        this.state.player = new Player(this.state.width / 2, this.state.height / 2);

        // Initial asteroids
        for (let i = 0; i < 3; i++) {
            this.state.asteroids.push(
                this.spawning.spawnAsteroid(1, this.state.player, this.state.width, this.state.height, true)
            );
        }

        // Reset systems
        this.spawning.reset();
        this.effects.reset();
        this.input.reset();

        // Keep stars
        if (this.state.stars.length === 0) {
            this._createStars();
        }

        // Hide restart button
        const restartBtn = document.getElementById('restart-button');
        if (restartBtn) restartBtn.style.display = 'none';
    }

    /**
     * Handle start input
     * @private
     */
    _handleStartInput() {
        if (this.state.gameState === 'title') {
            this.audio.resume();
            this._startGame();
        }
    }

    /**
     * Handle restart input
     * @private
     */
    _handleRestartInput() {
        if (this.state.gameState === 'gameOver') {
            this._startGame();
        }
    }

    /**
     * Resize canvas
     * @private
     */
    _resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.state.setDimensions(this.canvas.width, this.canvas.height);
        this._createStars();
    }

    /**
     * Create starfield
     * @private
     */
    _createStars() {
        const { width, height } = this.state;
        this.state.stars = [];
        const count = Math.min(200, Math.floor(width * height / 5000));

        for (let i = 0; i < count; i++) {
            this.state.stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: Math.random() * 1.5 + 0.2,
                color: Math.random() > 0.95 ? "#FF00FF" : (Math.random() > 0.9 ? "#00FFFF" : "#FFFFFF")
            });
        }
    }

    /**
     * Handle resize
     * @private
     */
    _handleResize() {
        this._resizeCanvas();
    }

    /**
     * Handle orientation change
     * @private
     */
    _handleOrientationChange() {
        // Could pause game in portrait, etc.
    }

    /**
     * Expose test API
     * @private
     */
    _exposeTestAPI() {
        if (typeof window !== 'undefined') {
            window.__COSMIC_ASSAULT_TEST_API__ = {
                version: '2.0.0',
                getState: () => ({
                    ...this.state.getSnapshot(),
                    isMobileControlsActive: this.isMobile
                }),
                getPlayer: () => this.state.player ? this.state.player.getState() : null,
                getEntityCounts: () => this.state.getEntityCounts(),
                getAsteroids: () => this.state.asteroids.map(a => ({ x: a.x, y: a.y, size: a.size, radius: a.radius, isMeteor: a.isMeteor })),
                getPowerups: () => this.state.powerups.map(p => ({ x: p.x, y: p.y, type: p.type, lifespan: p.lifespan })),
                getCanvasDimensions: () => ({ width: this.state.width, height: this.state.height }),
                simulateKeyDown: (key) => this.input.simulateKeyDown(key),
                simulateKeyUp: (key) => this.input.simulateKeyUp(key),
                simulateKeyPress: (key, durationMs = 100) => {
                    this.input.simulateKeyDown(key);
                    setTimeout(() => this.input.simulateKeyUp(key), durationMs);
                },
                simulateJoystick: (angle, distance) => this.input.simulateJoystick(angle, distance),
                releaseJoystick: () => this.input.releaseJoystick(),
                startGame: () => this._handleStartInput() || this._handleRestartInput(),
                waitForState: (targetState, timeoutMs = 5000) => {
                    return new Promise((resolve, reject) => {
                        const startTime = Date.now();
                        const check = () => {
                            if (this.state.gameState === targetState) resolve(this.state.gameState);
                            else if (Date.now() - startTime > timeoutMs) reject(new Error(`Timeout waiting for state: ${targetState}`));
                            else requestAnimationFrame(check);
                        };
                        check();
                    });
                },
                waitForCondition: (conditionFn, timeoutMs = 5000) => {
                    return new Promise((resolve, reject) => {
                        const startTime = Date.now();
                        const check = () => {
                            try {
                                if (conditionFn()) resolve(true);
                                else if (Date.now() - startTime > timeoutMs) reject(new Error('Timeout waiting for condition'));
                                else requestAnimationFrame(check);
                            } catch (e) { reject(e); }
                        };
                        check();
                    });
                },
                getConfig: () => ({
                    SHIP_SIZE,
                    POWERUP_TYPES: [...POWERUP_TYPES],
                    POWERUP_CONFIG: { ...POWERUP_CONFIG },
                    levelThresholds: [...LEVEL_THRESHOLDS]
                }),
                isReady: () => !!(this.canvas && this.ctx && this.state.gameState)
            };
            window.__COSMIC_ASSAULT_TEST_API_READY__ = true;
            console.log('[Cosmic Assault] Test API loaded (v2.0.0 - Modular)');
        }
    }
}
