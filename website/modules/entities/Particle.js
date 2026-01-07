/**
 * Particle Classes
 * Visual effect particles for explosions, trails, etc.
 */

import { LifespanEntity } from './Entity.js';
import { hexToRgb } from '../utils/color.js';
import { DEFAULT_FONT } from '../core/constants.js';

/**
 * Basic particle for explosions and effects
 */
export class Particle extends LifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} vx
     * @param {number} vy
     * @param {number} size - Particle size
     * @param {string} color - CSS color string
     * @param {number} life - Lifespan in seconds
     */
    constructor(x, y, vx, vy, size, color, life) {
        super(x, y, vx, vy, life);
        this.size = size;
        this.initialSize = size;
        this.color = color;
        this.drag = 0.99;
    }

    /**
     * Update particle with drag and size shrinking
     * @param {number} deltaTime
     */
    update(deltaTime) {
        super.update(deltaTime);
        this.vx *= this.drag;
        this.vy *= this.drag;
        // Shrink particle over time
        this.size = Math.max(0, this.initialSize * this.getLifeRatio());
    }

    /**
     * Draw the particle
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active || this.size <= 0.1) return;

        const alpha = this.getLifeRatio();

        try {
            ctx.fillStyle = this.color;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } catch (e) {
            ctx.fillStyle = "#FFFFFF";
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } finally {
            ctx.globalAlpha = 1.0;
        }
    }
}

/**
 * Text particle for floating notifications (score popups, etc.)
 */
export class TextParticle extends LifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {string} text - Text to display
     * @param {string} color - Text color
     * @param {number} life - Lifespan in seconds
     */
    constructor(x, y, text, color, life) {
        super(x, y, 0, -40, life); // Float upward
        this.text = text;
        this.color = color;
        this.fontSize = 20;
    }

    /**
     * Update with font size shrinking
     * @param {number} deltaTime
     */
    update(deltaTime) {
        super.update(deltaTime);
        this.fontSize = Math.max(5, 20 * this.getLifeRatio());
    }

    /**
     * Draw the text
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active) return;

        const alpha = this.getLifeRatio();

        try {
            ctx.fillStyle = this.color;
            ctx.globalAlpha = alpha;
            ctx.font = `bold ${Math.round(this.fontSize)}px ${DEFAULT_FONT}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(this.text, this.x, this.y);
        } catch (e) {
            ctx.fillStyle = "#FFFFFF";
            ctx.globalAlpha = alpha;
            ctx.font = `bold ${Math.round(this.fontSize)}px ${DEFAULT_FONT}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(this.text, this.x, this.y);
        } finally {
            ctx.globalAlpha = 1.0;
        }
    }
}

/**
 * Blast radius particle for field bomb explosion visualization
 */
export class BlastRadiusParticle extends LifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} maxRadius - Maximum radius of the blast
     * @param {number} delay - Delay before starting
     * @param {string} color - Ring color
     */
    constructor(x, y, maxRadius, delay, color) {
        super(x, y, 0, 0, 0.8); // Short life for the ring pulse
        this.maxRadius = maxRadius;
        this.currentRadius = 0;
        this.delay = delay;
        this.color = color;
    }

    /**
     * Update with expansion
     * @param {number} deltaTime
     */
    update(deltaTime) {
        if (this.delay > 0) {
            this.delay -= deltaTime;
            return;
        }
        super.update(deltaTime);
        if (this.active) {
            this.currentRadius = this.maxRadius * (1 - this.getLifeRatio());
        }
    }

    /**
     * Draw the expanding ring
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (this.delay > 0 || !this.active) return;

        const alpha = this.getLifeRatio();
        ctx.save();
        ctx.strokeStyle = `rgba(${hexToRgb(this.color)}, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}
