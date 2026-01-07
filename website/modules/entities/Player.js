/**
 * Player Class
 * The player's ship with movement, shooting, and powerup effects
 */

import { Entity } from './Entity.js';
import { hexToRgb } from '../utils/color.js';
import {
    SHIP_SIZE,
    SHIP_COLOR,
    POWERUP_COLORS,
    PLAYER_CONFIG
} from '../core/constants.js';

export class Player extends Entity {
    /**
     * @param {number} x
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y, 0, 0);

        this.angle = -Math.PI / 2; // Start facing up
        this.thrusting = false;
        this.alive = true;

        // Movement properties
        this.turnSpeed = PLAYER_CONFIG.turnSpeed;
        this.thrustPower = PLAYER_CONFIG.thrustPower;
        this.drag = PLAYER_CONFIG.drag;
        this.maxSpeed = PLAYER_CONFIG.maxSpeed;

        // Combat properties
        this.shootTimer = 0;
        this.baseFireRate = PLAYER_CONFIG.baseFireRate;
        this.projectileSpeed = PLAYER_CONFIG.projectileSpeed;

        // State flags
        this.invulnerable = true;
        this.invulnerabilityTimer = PLAYER_CONFIG.invulnerabilityTime;
        this.shielded = false;

        // Powerup modifiers
        this.fireRateMultiplier = 1;
        this.weaponCountMultiplier = 1;

        // Mobile control state
        this.currentJoystickDistance = 0;

        // Set radius for collision
        this.radius = SHIP_SIZE / 2;
    }

    /**
     * Update player state
     * @param {number} deltaTime
     * @param {Object} input - Input state { keys, joystickActive, joystickAngle, joystickDistance }
     * @param {number} screenWidth
     * @param {number} screenHeight
     * @param {Function} onShoot - Callback when shooting (returns projectile data)
     * @param {Function} createParticle - Callback to create thruster particles
     */
    update(deltaTime, input, screenWidth, screenHeight, onShoot, createParticle) {
        // Update invulnerability
        if (this.invulnerable) {
            this.invulnerabilityTimer -= deltaTime;
            if (this.invulnerabilityTimer <= 0) {
                this.invulnerable = false;
            }
        }

        // Update shoot cooldown
        if (this.shootTimer > 0) {
            this.shootTimer -= deltaTime;
        }

        // Process input
        this.thrusting = false;

        if (input.joystickActive) {
            this._handleJoystickInput(deltaTime, input);
        } else {
            this._handleKeyboardInput(deltaTime, input.keys);
        }

        // Shooting (Space or Shift to fire)
        if (this.isFireKeyPressed(input.keys) && this.shootTimer <= 0 && onShoot) {
            this._shoot(onShoot);
        }

        // Physics
        this._applyPhysics(deltaTime, input.joystickActive);

        // Screen wrap
        this.wrap(screenWidth, screenHeight);

        // Thruster particles
        if (this.thrusting && createParticle && Math.random() < 0.4) {
            this._createThrusterParticle(createParticle);
        }
    }

    /**
     * Handle joystick input
     * @param {number} deltaTime
     * @param {Object} input
     * @private
     */
    _handleJoystickInput(deltaTime, input) {
        if (input.joystickDistance > 10) {
            this.angle = input.joystickAngle;
            this.thrusting = true;

            const thrustMagnitude = Math.min(input.joystickDistance / 60, 1);
            this.vx += Math.cos(this.angle) * this.thrustPower * thrustMagnitude * deltaTime;
            this.vy += Math.sin(this.angle) * this.thrustPower * thrustMagnitude * deltaTime;

            this.currentJoystickDistance = input.joystickDistance;
        } else {
            this.currentJoystickDistance = 0;
        }
    }

    /**
     * Handle keyboard input
     * @param {number} deltaTime
     * @param {Object} keys
     * @private
     */
    _handleKeyboardInput(deltaTime, keys) {
        // Support both Arrow keys and WASD
        if (keys["ArrowLeft"] || keys["a"] || keys["A"]) {
            this.angle -= this.turnSpeed * deltaTime;
        }
        if (keys["ArrowRight"] || keys["d"] || keys["D"]) {
            this.angle += this.turnSpeed * deltaTime;
        }
        if (keys["ArrowUp"] || keys["w"] || keys["W"]) {
            this.thrusting = true;
            this.vx += Math.cos(this.angle) * this.thrustPower * deltaTime;
            this.vy += Math.sin(this.angle) * this.thrustPower * deltaTime;
        }
        this.currentJoystickDistance = 0;
    }

    /**
     * Check if fire key is pressed (Space or Shift)
     * @param {Object} keys
     * @returns {boolean}
     */
    isFireKeyPressed(keys) {
        return keys[' '] || keys['Shift'];
    }

    /**
     * Apply physics (drag, speed limiting)
     * @param {number} deltaTime
     * @param {boolean} joystickActive
     * @private
     */
    _applyPhysics(deltaTime, joystickActive) {
        // Adaptive drag for joystick
        let currentDrag = this.drag;
        if (joystickActive && this.currentJoystickDistance > 10) {
            const dragReductionFactor = Math.min(this.currentJoystickDistance / 120, 0.5);
            currentDrag = this.drag + dragReductionFactor * (1 - this.drag);
            currentDrag = Math.min(currentDrag, 0.995);
        }

        this.vx *= currentDrag;
        this.vy *= currentDrag;

        // Speed limit
        this.limitSpeed(this.maxSpeed);

        // Update position
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
    }

    /**
     * Fire projectiles
     * @param {Function} onShoot - Callback that receives projectile data
     * @private
     */
    _shoot(onShoot) {
        this.shootTimer = this.baseFireRate / this.fireRateMultiplier;

        const noseOffset = SHIP_SIZE * 0.8;
        const startX = this.x + Math.cos(this.angle) * noseOffset;
        const startY = this.y + Math.sin(this.angle) * noseOffset;

        const baseVx = this.vx * 0.5;
        const baseVy = this.vy * 0.5;

        onShoot({
            x: startX,
            y: startY,
            angle: this.angle,
            baseVx,
            baseVy,
            speed: this.projectileSpeed,
            weaponMultiplier: this.weaponCountMultiplier
        });
    }

    /**
     * Create thruster particle
     * @param {Function} createParticle
     * @private
     */
    _createThrusterParticle(createParticle) {
        const particleAngle = this.angle + Math.PI + (Math.random() - 0.5) * 0.5;
        const particleSpeed = Math.random() * 50 + 30;
        const particleX = this.x - Math.cos(this.angle) * (SHIP_SIZE * 0.6);
        const particleY = this.y - Math.sin(this.angle) * (SHIP_SIZE * 0.6);

        createParticle(
            particleX, particleY,
            this.vx + Math.cos(particleAngle) * particleSpeed,
            this.vy + Math.sin(particleAngle) * particleSpeed,
            Math.random() * 2 + 1,
            Math.random() > 0.5 ? "#FF5500" : "#FFFF00",
            0.4
        );
    }

    /**
     * Draw the player
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.alive) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // Blinking effect when invulnerable
        const visible = !this.invulnerable || Math.floor(Date.now() / 100) % 2 === 0;

        if (visible) {
            this._drawShield(ctx);
            this._drawShip(ctx);
            this._drawThruster(ctx);
        }

        ctx.restore();
    }

    /**
     * Draw shield effect
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _drawShield(ctx) {
        if (!this.shielded) return;

        ctx.beginPath();
        ctx.arc(0, 0, SHIP_SIZE * 1.1, 0, Math.PI * 2);
        ctx.strokeStyle = POWERUP_COLORS.shield;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = POWERUP_COLORS.shield;
        ctx.shadowBlur = 15;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    /**
     * Draw ship body
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _drawShip(ctx) {
        ctx.beginPath();
        ctx.moveTo(SHIP_SIZE * 0.8, 0); // Nose
        ctx.lineTo(-SHIP_SIZE * 0.5, -SHIP_SIZE * 0.5); // Top-left wing
        ctx.lineTo(-SHIP_SIZE * 0.3, 0); // Mid-back indentation
        ctx.lineTo(-SHIP_SIZE * 0.5, SHIP_SIZE * 0.5); // Bottom-left wing
        ctx.closePath();

        ctx.strokeStyle = SHIP_COLOR;
        ctx.lineWidth = 2;
        ctx.fillStyle = `rgba(${hexToRgb(SHIP_COLOR)}, 0.1)`;

        ctx.shadowColor = SHIP_COLOR;
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    /**
     * Draw thruster flame
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _drawThruster(ctx) {
        if (!this.thrusting) return;

        ctx.beginPath();
        const flameLength = SHIP_SIZE * (0.8 + Math.random() * 0.4);
        ctx.moveTo(-SHIP_SIZE * 0.3, 0);
        ctx.lineTo(-SHIP_SIZE * 0.3 - flameLength, 0);

        const flameGrad = ctx.createLinearGradient(
            -SHIP_SIZE * 0.3, 0,
            -SHIP_SIZE * 0.3 - flameLength, 0
        );
        flameGrad.addColorStop(0, "#FFFF00");
        flameGrad.addColorStop(1, "#FF5500");

        ctx.strokeStyle = flameGrad;
        ctx.lineWidth = 3 + Math.random();
        ctx.shadowColor = "#FF5500";
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    /**
     * Handle player taking damage
     * @param {number} screenWidth
     * @param {number} screenHeight
     * @returns {boolean} True if player died
     */
    hit(screenWidth, screenHeight) {
        if (this.invulnerable) return false;

        if (this.shielded) {
            this.shielded = false;
            return false;
        }

        return true; // Player takes damage
    }

    /**
     * Respawn player at center
     * @param {number} screenWidth
     * @param {number} screenHeight
     */
    respawn(screenWidth, screenHeight) {
        this.x = screenWidth / 2;
        this.y = screenHeight / 2;
        this.vx = 0;
        this.vy = 0;
        this.invulnerable = true;
        this.invulnerabilityTimer = PLAYER_CONFIG.invulnerabilityTime;
    }

    /**
     * Activate shield powerup
     */
    activateShield() {
        this.shielded = true;
    }

    /**
     * Deactivate shield
     */
    deactivateShield() {
        this.shielded = false;
    }

    /**
     * Set fire rate multiplier
     * @param {number} multiplier
     */
    setFireRateMultiplier(multiplier) {
        this.fireRateMultiplier = multiplier;
    }

    /**
     * Set weapon count multiplier
     * @param {number} multiplier
     */
    setWeaponCountMultiplier(multiplier) {
        this.weaponCountMultiplier = multiplier;
    }

    /**
     * Reset all powerup effects
     */
    resetPowerups() {
        this.shielded = false;
        this.fireRateMultiplier = 1;
        this.weaponCountMultiplier = 1;
    }

    /**
     * Get player state for test API
     * @returns {Object}
     */
    getState() {
        return {
            x: this.x,
            y: this.y,
            angle: this.angle,
            vx: this.vx,
            vy: this.vy,
            alive: this.alive,
            invulnerable: this.invulnerable,
            shielded: this.shielded,
            weaponCountMultiplier: this.weaponCountMultiplier,
            fireRateMultiplier: this.fireRateMultiplier
        };
    }
}
