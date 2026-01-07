/**
 * Projectile Class
 * Player-fired projectiles
 */

import { LifespanEntity } from './Entity.js';
import { hexToRgb } from '../utils/color.js';
import { PROJECTILE_COLOR, TIMING } from '../core/constants.js';

export class Projectile extends LifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} vx
     * @param {number} vy
     */
    constructor(x, y, vx, vy) {
        super(x, y, vx, vy, TIMING.projectileLifespan);
        this.radius = 3;
        this.color = PROJECTILE_COLOR;
    }

    /**
     * Update with screen wrapping
     * @param {number} deltaTime
     * @param {number} screenWidth
     * @param {number} screenHeight
     */
    update(deltaTime, screenWidth, screenHeight) {
        super.update(deltaTime);
        this.wrap(screenWidth, screenHeight);
    }

    /**
     * Draw the projectile with glow and trail
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active) return;

        ctx.save();
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 12;

        // Draw core dot
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Draw subtle trail
        const trailLengthFactor = 0.05;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - this.vx * trailLengthFactor, this.y - this.vy * trailLengthFactor);
        ctx.strokeStyle = `rgba(${hexToRgb(this.color)}, 0.6)`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    }
}
