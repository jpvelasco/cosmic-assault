/**
 * GravityField Class
 * Gravitational or repulsion fields that affect entities
 */

import { LifespanEntity } from './Entity.js';
import { TIMING } from '../core/constants.js';

export class GravityField extends LifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} radius - Field radius
     * @param {number} strength - Positive = pull, negative = push
     */
    constructor(x, y, radius, strength) {
        super(x, y, 0, 0, TIMING.gravityFieldLifespan);
        this.radius = radius;
        this.strength = strength;
        this.pulseRate = 300;
    }

    /**
     * Apply gravitational force to an entity
     * @param {Object} entity - Entity with x, y, vx, vy properties
     * @param {number} deltaTime
     */
    applyGravity(entity, deltaTime) {
        if (!this.active) return;

        const dx = this.x - entity.x;
        const dy = this.y - entity.y;
        const distSq = dx * dx + dy * dy;
        const radiusSq = this.radius * this.radius;

        if (distSq < radiusSq && distSq > 1) {
            const distance = Math.sqrt(distSq);
            // Force falls off quadratically with distance from edge
            const falloff = Math.pow(1 - (distance / this.radius), 2);
            const baseForce = 2500;
            const forceMagnitude = this.strength * falloff * baseForce * deltaTime / distance;

            entity.vx += (dx / distance) * forceMagnitude;
            entity.vy += (dy / distance) * forceMagnitude;
        }
    }

    /**
     * Draw the gravity field
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        if (!this.active) return;

        const pulse = 0.9 + 0.1 * Math.sin(Date.now() / this.pulseRate);
        const currentRadius = this.radius * pulse;
        const alpha = Math.min(1, this.lifespan / 5) * 0.4; // Fade out last 5 seconds

        const isPull = this.strength > 0;
        const color = isPull
            ? `rgba(255, 0, 255, ${alpha})`
            : `rgba(0, 255, 255, ${alpha})`;
        const edgeColor = isPull
            ? `rgba(255, 0, 255, ${alpha * 0.1})`
            : `rgba(0, 255, 255, ${alpha * 0.1})`;

        ctx.save();

        const gradient = ctx.createRadialGradient(
            this.x, this.y, 0,
            this.x, this.y, currentRadius
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.7, color);
        gradient.addColorStop(1, edgeColor);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();

        // Blinking border when fading
        if (this.lifespan < 3 && Math.floor(Date.now() / 150) % 2 === 0) {
            ctx.strokeStyle = isPull ? "#FF00FF" : "#00FFFF";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Check if this is a pull (gravity well) or push (repulsion field)
     * @returns {boolean}
     */
    isPull() {
        return this.strength > 0;
    }
}
