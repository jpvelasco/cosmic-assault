/**
 * Powerup Class
 * Collectible powerups that grant temporary abilities
 */

import { RotatingLifespanEntity } from './Entity.js';
import { hexToRgb } from '../utils/color.js';
import { shouldBeVisible } from '../utils/effects.js';
import { randomRange } from '../utils/math.js';
import { POWERUP_CONFIG, TIMING } from '../core/constants.js';

export class Powerup extends RotatingLifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {string} type - Powerup type (doubleShot, rapidFire, shield, fieldBomb)
     */
    constructor(x, y, type) {
        const angle = Math.random() * Math.PI * 2;
        const speed = randomRange(30, 50);
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const rotation = 0;
        const rotationSpeed = (Math.random() - 0.5) * 2;

        super(x, y, vx, vy, TIMING.powerupLifespan, rotation, rotationSpeed);

        this.type = type;
        this.radius = 12;
        this.color = POWERUP_CONFIG[type]?.color || '#FFFFFF';
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
     * Draw the powerup
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active) return;

        // Blinking effect when about to disappear
        if (!shouldBeVisible(this.lifespan, 3, Date.now(), 150)) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        const rgb = hexToRgb(this.color);

        ctx.strokeStyle = this.color;
        ctx.fillStyle = `rgba(${rgb}, 0.3)`;
        ctx.lineWidth = 2;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10 + 5 * Math.abs(Math.sin(Date.now() / 200)); // Pulsing glow

        // Draw shape based on type
        ctx.beginPath();
        this._drawShape(ctx);
        ctx.stroke();
        ctx.fill();

        ctx.restore();
    }

    /**
     * Draw the powerup shape based on type
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _drawShape(ctx) {
        const r = this.radius;

        switch (this.type) {
            case 'shield':
                // Circle with cross
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.moveTo(-r * 0.6, 0);
                ctx.lineTo(r * 0.6, 0);
                ctx.moveTo(0, -r * 0.6);
                ctx.lineTo(0, r * 0.6);
                break;

            case 'rapidFire':
                // Lightning bolt
                ctx.moveTo(0, -r);
                ctx.lineTo(r * 0.5, -r * 0.2);
                ctx.lineTo(-r * 0.3, r * 0.3);
                ctx.lineTo(0, r);
                break;

            case 'doubleShot':
                // Two parallel bars
                ctx.rect(-r * 0.6, -r * 0.7, r * 0.4, r * 1.4);
                ctx.rect(r * 0.2, -r * 0.7, r * 0.4, r * 1.4);
                break;

            case 'fieldBomb':
                // Double circle (bomb)
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.moveTo(r * 0.4, 0);
                ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
                break;

            default:
                // Default square
                ctx.rect(-r, -r, r * 2, r * 2);
        }
    }

    /**
     * Get the powerup configuration
     * @returns {Object}
     */
    getConfig() {
        return POWERUP_CONFIG[this.type] || { duration: 0, color: '#FFFFFF' };
    }
}
