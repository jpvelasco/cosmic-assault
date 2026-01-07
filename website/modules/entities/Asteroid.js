/**
 * Asteroid Class
 * Asteroids that the player must destroy
 */

import { RotatingEntity } from './Entity.js';
import { hexToRgb } from '../utils/color.js';
import { randomRange } from '../utils/math.js';
import {
    ASTEROID_COLOR,
    ASTEROID_RADII,
    ASTEROID_BASE_SPEEDS,
    ASTEROID_SIZES
} from '../core/constants.js';

export class Asteroid extends RotatingEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} size - Size index (0=Large, 1=Medium, 2=Small, 3=Tiny)
     * @param {number} angle - Movement angle in radians
     * @param {number} speedMultiplier - Speed modifier
     * @param {boolean} isMeteor - Whether this is a meteor (has trail)
     */
    constructor(x, y, size, angle, speedMultiplier = 1, isMeteor = false) {
        const rotation = Math.random() * Math.PI * 2;
        const rotationSpeed = (Math.random() - 0.5) * (isMeteor ? 4 : 2);

        super(x, y, 0, 0, rotation, rotationSpeed);

        this.size = size;
        this.isMeteor = isMeteor;
        this.hasTrail = isMeteor;

        // Size and Speed setup
        this.radius = ASTEROID_RADII[size] || 15;
        const baseSpeed = isMeteor ? 250 : (ASTEROID_BASE_SPEEDS[size] || 140);
        const speed = baseSpeed * speedMultiplier * randomRange(0.8, 1.2);

        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;

        // Generate jagged shape
        this.vertices = this._generateVertices();
    }

    /**
     * Generate random jagged vertices for asteroid shape
     * @returns {Array<{x: number, y: number}>}
     * @private
     */
    _generateVertices() {
        const vertices = [];
        const numVertices = Math.floor(Math.random() * 5) + 7; // 7-11 vertices
        const jaggedness = 0.3;

        for (let i = 0; i < numVertices; i++) {
            const vertexAngle = (i / numVertices) * Math.PI * 2;
            const distance = this.radius * (1 + (Math.random() - 0.5) * 2 * jaggedness);
            vertices.push({
                x: Math.cos(vertexAngle) * distance,
                y: Math.sin(vertexAngle) * distance
            });
        }

        return vertices;
    }

    /**
     * Update asteroid position
     * @param {number} deltaTime
     * @param {number} screenWidth
     * @param {number} screenHeight
     * @param {Function} createParticle - Callback to create trail particles
     */
    update(deltaTime, screenWidth, screenHeight, createParticle = null) {
        super.update(deltaTime);
        this.wrap(screenWidth, screenHeight);

        // Create meteor trail
        if (this.hasTrail && createParticle && Math.random() < 0.5) {
            createParticle(
                this.x, this.y,
                this.vx * -0.05, this.vy * -0.05,
                randomRange(0.5, 2),
                this.isMeteor ? "#FF5500" : ASTEROID_COLOR,
                randomRange(0.3, 0.5)
            );
        }
    }

    /**
     * Draw the asteroid
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        ctx.beginPath();
        ctx.moveTo(this.vertices[0].x, this.vertices[0].y);
        for (let i = 1; i < this.vertices.length; i++) {
            ctx.lineTo(this.vertices[i].x, this.vertices[i].y);
        }
        ctx.closePath();

        ctx.strokeStyle = this.isMeteor ? "#FFA500" : ASTEROID_COLOR;
        ctx.lineWidth = 1.5;
        ctx.fillStyle = `rgba(${hexToRgb(ASTEROID_COLOR)}, ${this.isMeteor ? 0.05 : 0.1})`;

        ctx.stroke();
        ctx.fill();

        ctx.restore();
    }

    /**
     * Check if asteroid can break into smaller pieces
     * @returns {boolean}
     */
    canBreak() {
        return this.size < ASTEROID_SIZES.TINY;
    }

    /**
     * Get the size index for child asteroids
     * @returns {number}
     */
    getChildSize() {
        return this.size + 1;
    }
}
