/**
 * DangerZone Class
 * Rectangular hazard zones that damage the player
 */

import { LifespanEntity } from './Entity.js';
import { TIMING } from '../core/constants.js';

export class DangerZone extends LifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     */
    constructor(x, y, width, height) {
        super(x, y, 0, 0, TIMING.dangerZoneLifespan);
        this.width = width;
        this.height = height;
        this.warningTime = TIMING.dangerZoneWarningTime;
        this.damageInterval = 0.5;
        this.damageTimer = 0;
    }

    /**
     * Update danger zone
     * @param {number} deltaTime
     */
    update(deltaTime) {
        super.update(deltaTime);
        if (this.damageTimer > 0) {
            this.damageTimer -= deltaTime;
        }
    }

    /**
     * Check collision with an entity (only damages after warning period)
     * @param {Object} entity - Entity with x, y properties
     * @returns {boolean} True if entity was hit
     */
    checkCollision(entity) {
        // Only damage if active, past warning time, and damage timer ready
        if (!this.active || this.isInWarningPhase() || this.damageTimer > 0) {
            return false;
        }

        // Simple AABB collision check
        if (entity.x > this.x && entity.x < this.x + this.width &&
            entity.y > this.y && entity.y < this.y + this.height) {
            this.damageTimer = this.damageInterval;
            return true;
        }

        return false;
    }

    /**
     * Check if still in warning phase
     * @returns {boolean}
     */
    isInWarningPhase() {
        return this.lifespan > (this.initialLife - this.warningTime);
    }

    /**
     * Draw the danger zone
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active) return;

        const isWarning = this.isInWarningPhase();
        const baseAlpha = 0.25;
        const pulseAlpha = baseAlpha + 0.15 * Math.abs(Math.sin(Date.now() / (isWarning ? 200 : 400)));
        const color = isWarning
            ? `rgba(255, 255, 0, ${pulseAlpha})`
            : `rgba(255, 0, 0, ${pulseAlpha})`;

        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Blinking border when fading
        if (this.lifespan < 2 && Math.floor(Date.now() / 150) % 2 === 0) {
            ctx.strokeStyle = isWarning ? "#FFFF00" : "#FF0000";
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x, this.y, this.width, this.height);
        }

        ctx.restore();
    }

    /**
     * Get center position
     * @returns {{x: number, y: number}}
     */
    getCenter() {
        return {
            x: this.x + this.width / 2,
            y: this.y + this.height / 2
        };
    }
}
