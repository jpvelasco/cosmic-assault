/**
 * BonusTarget Class
 * Special targets during bonus rounds that award points
 */

import { RotatingLifespanEntity } from './Entity.js';
import { hexToRgb } from '../utils/color.js';
import { randomRange } from '../utils/math.js';
import { shouldBeVisible } from '../utils/effects.js';
import { DEFAULT_FONT } from '../core/constants.js';

export class BonusTarget extends RotatingLifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} points - Point value of this target
     */
    constructor(x, y, points) {
        const speed = randomRange(40, 80);
        const moveAngle = Math.random() * Math.PI * 2;
        const vx = Math.cos(moveAngle) * speed;
        const vy = Math.sin(moveAngle) * speed;
        const lifespan = randomRange(6, 10);
        const rotation = 0;
        const rotationSpeed = (Math.random() - 0.5) * 4;

        super(x, y, vx, vy, lifespan, rotation, rotationSpeed);

        this.points = points;
        this.radius = 18;

        // Color based on points
        this.color = this._getColorForPoints(points);
        this.rgb = hexToRgb(this.color);
    }

    /**
     * Get color based on point value
     * @param {number} points
     * @returns {string}
     * @private
     */
    _getColorForPoints(points) {
        if (points === 100) return "#FFFF00"; // Yellow
        if (points === 200) return "#FF00FF"; // Magenta
        return "#00FFFF"; // Cyan for 300+
    }

    /**
     * Update with bouncing off edges
     * @param {number} deltaTime
     * @param {number} screenWidth
     * @param {number} screenHeight
     */
    update(deltaTime, screenWidth, screenHeight) {
        super.update(deltaTime);

        // Bounce off edges
        if ((this.x < this.radius && this.vx < 0) ||
            (this.x > screenWidth - this.radius && this.vx > 0)) {
            this.vx *= -1;
        }
        if ((this.y < this.radius && this.vy < 0) ||
            (this.y > screenHeight - this.radius && this.vy > 0)) {
            this.vy *= -1;
        }

        // Keep within bounds
        this.x = Math.max(this.radius, Math.min(screenWidth - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(screenHeight - this.radius, this.y));
    }

    /**
     * Draw the bonus target
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active) return;

        // Blinking when near end of life
        if (!shouldBeVisible(this.lifespan, 2, Date.now(), 100)) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        const pulse = 1 + 0.1 * Math.sin(Date.now() / 150);
        const currentRadius = this.radius * pulse;

        // Draw star shape
        this._drawStar(ctx, currentRadius);

        ctx.strokeStyle = this.color;
        ctx.fillStyle = `rgba(${this.rgb}, 0.4)`;
        ctx.lineWidth = 2;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 15;

        ctx.stroke();
        ctx.fill();

        // Draw points value inside
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#FFFFFF";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${Math.round(this.radius * 0.8)}px ${DEFAULT_FONT}`;
        ctx.fillText(this.points.toString(), 0, 0);

        ctx.restore();
    }

    /**
     * Draw a 5-pointed star
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} radius
     * @private
     */
    _drawStar(ctx, radius) {
        const spikes = 5;
        const outerRadius = radius;
        const innerRadius = radius * 0.5;

        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.closePath();
    }
}
