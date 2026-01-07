/**
 * Base Entity Class
 * Common functionality for all game entities (position, velocity, lifespan, etc.)
 */

export class Entity {
    /**
     * @param {number} x - Initial X position
     * @param {number} y - Initial Y position
     * @param {number} vx - Initial X velocity
     * @param {number} vy - Initial Y velocity
     */
    constructor(x, y, vx = 0, vy = 0) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.active = true;
        this.radius = 0; // For collision detection
    }

    /**
     * Update entity position based on velocity
     * @param {number} deltaTime - Time since last frame in seconds
     */
    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
    }

    /**
     * Wrap entity position around screen edges
     * @param {number} width - Screen width
     * @param {number} height - Screen height
     * @param {number} buffer - Buffer zone outside screen
     */
    wrap(width, height, buffer = 50) {
        if (this.x < -buffer) this.x = width + buffer;
        else if (this.x > width + buffer) this.x = -buffer;
        if (this.y < -buffer) this.y = height + buffer;
        else if (this.y > height + buffer) this.y = -buffer;
    }

    /**
     * Check if entity is within screen bounds
     * @param {number} width - Screen width
     * @param {number} height - Screen height
     * @param {number} margin - Margin outside screen
     * @returns {boolean}
     */
    isOnScreen(width, height, margin = 0) {
        return this.x >= -margin &&
               this.x <= width + margin &&
               this.y >= -margin &&
               this.y <= height + margin;
    }

    /**
     * Get speed (magnitude of velocity)
     * @returns {number}
     */
    getSpeed() {
        return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    }

    /**
     * Limit speed to a maximum value
     * @param {number} maxSpeed
     */
    limitSpeed(maxSpeed) {
        const speed = this.getSpeed();
        if (speed > maxSpeed) {
            const scale = maxSpeed / speed;
            this.vx *= scale;
            this.vy *= scale;
        }
    }

    /**
     * Apply drag to velocity
     * @param {number} drag - Drag coefficient (0-1, closer to 1 = less drag)
     */
    applyDrag(drag) {
        this.vx *= drag;
        this.vy *= drag;
    }

    /**
     * Draw the entity (override in subclasses)
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
        // Override in subclasses
    }

    /**
     * Mark entity for removal
     */
    destroy() {
        this.active = false;
    }
}

/**
 * Entity with lifespan (auto-expires)
 */
export class LifespanEntity extends Entity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} vx
     * @param {number} vy
     * @param {number} lifespan - Lifespan in seconds
     */
    constructor(x, y, vx, vy, lifespan) {
        super(x, y, vx, vy);
        this.lifespan = lifespan;
        this.initialLife = lifespan;
    }

    /**
     * Update with lifespan countdown
     * @param {number} deltaTime
     */
    update(deltaTime) {
        super.update(deltaTime);
        this.lifespan -= deltaTime;
        if (this.lifespan <= 0) {
            this.active = false;
        }
    }

    /**
     * Get remaining life as a ratio (0-1)
     * @returns {number}
     */
    getLifeRatio() {
        return Math.max(0, this.lifespan / this.initialLife);
    }

    /**
     * Check if entity is near end of life (for blinking effects)
     * @param {number} threshold - Seconds remaining to trigger
     * @returns {boolean}
     */
    isNearDeath(threshold = 3) {
        return this.lifespan <= threshold;
    }
}

/**
 * Entity with rotation
 */
export class RotatingEntity extends Entity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} vx
     * @param {number} vy
     * @param {number} rotation - Initial rotation in radians
     * @param {number} rotationSpeed - Rotation speed in radians/second
     */
    constructor(x, y, vx, vy, rotation = 0, rotationSpeed = 0) {
        super(x, y, vx, vy);
        this.rotation = rotation;
        this.rotationSpeed = rotationSpeed;
    }

    /**
     * Update with rotation
     * @param {number} deltaTime
     */
    update(deltaTime) {
        super.update(deltaTime);
        this.rotation += this.rotationSpeed * deltaTime;
    }
}

/**
 * Entity with both lifespan and rotation
 */
export class RotatingLifespanEntity extends LifespanEntity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} vx
     * @param {number} vy
     * @param {number} lifespan
     * @param {number} rotation
     * @param {number} rotationSpeed
     */
    constructor(x, y, vx, vy, lifespan, rotation = 0, rotationSpeed = 0) {
        super(x, y, vx, vy, lifespan);
        this.rotation = rotation;
        this.rotationSpeed = rotationSpeed;
    }

    /**
     * Update with rotation and lifespan
     * @param {number} deltaTime
     */
    update(deltaTime) {
        super.update(deltaTime);
        this.rotation += this.rotationSpeed * deltaTime;
    }
}
