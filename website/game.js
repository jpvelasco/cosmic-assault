/**
 * Cosmic Assault - A retro-style space shooter game
 * Features mobile and desktop controls with adaptive gameplay
 * Created: March 2025 (Concept)
 *
 * Refactored for single-file structure and minor optimizations.
 */

// Strict mode helps catch common coding errors
"use strict";

//=============================================================================
// GAME CONSTANTS & CONFIGURATION
//=============================================================================
const SHIP_SIZE = 20;
const MAX_PARTICLES = 150; // Limit particles for performance
const SHIP_COLOR = "#39FF14"; // Neon Green
const PROJECTILE_COLOR = "#FF00FF"; // Magenta
const ASTEROID_COLOR = "#4080FF"; // Blue
const TEXT_COLOR = "#39FF14";
const DEFAULT_FONT = "'Courier New', Courier, monospace";

const POWERUP_TYPES = ["doubleShot", "rapidFire", "shield", "fieldBomb"];
const POWERUP_COLORS = {
    doubleShot: "#FF00FF", // Magenta
    rapidFire: "#FFFF00", // Yellow
    shield: "#00FFFF", // Cyan
    fieldBomb: "#FF5500"  // Orange
};
const POWERUP_CONFIG = {
    doubleShot: { duration: 10, color: POWERUP_COLORS.doubleShot },
    rapidFire: { duration: 10, color: POWERUP_COLORS.rapidFire },
    shield: { duration: 15, color: POWERUP_COLORS.shield },
    fieldBomb: { duration: 0, color: POWERUP_COLORS.fieldBomb } // Instant
};

const basePowerupChance = 0.15;
const levelReduction = 0.02;
const minPowerupChance = 0.05;

// Effects configuration (centralized)
const EFFECTS = {
    explosion: { baseSize: 30, color: ASTEROID_COLOR, speed: 100, shake: 0.5, sound: 'explosion' },
    powerup: { baseSize: 20, color: '#FFFF00', speed: 50, shake: 0.2, sound: 'powerup' },
    fieldBomb: { baseSize: 100, color: POWERUP_COLORS.fieldBomb, speed: 200, shake: 1.0, sound: 'nuke' },
    shieldHit: { baseSize: 20, color: POWERUP_COLORS.shield, speed: 80, shake: 0.3, sound: 'explosion' } // Added for shield hit
};

// Notification configuration (centralized)
const NOTIFICATIONS = {
    levelUp: (level, multiplier) => ({ main: `LEVEL ${level}!`, sub: `SCORE MULTIPLIER: ${multiplier.toFixed(1)}x`, color: '#FFFF00', duration: 2 }),
    bonusRound: (multiplier) => ({ main: 'BONUS ROUND!', sub: `${multiplier}X POINTS!`, color: '#FFFF00', duration: 2 }),
    dangerZone: () => ({ main: 'DANGER ZONE!', color: '#FF0000', duration: 2 }),
    powerupCollected: (type) => ({ main: type.toUpperCase() + '!', color: POWERUP_COLORS[type] || '#FFFFFF', duration: 1.5 }),
    meteorShowerIncoming: () => ({ main: 'METEOR SHOWER INCOMING!', color: '#FF0000', duration: 2 }),
    meteorShowerEnded: () => ({ main: 'METEOR SHOWER ENDED', color: '#FFFF00', duration: 1.5 }),
    bonusRoundEnded: () => ({ main: 'BONUS ROUND ENDED', color: '#FFFF00', duration: 1.5 }),
    weaponUpgrade: (level) => ({ main: level === 3 ? 'MAXIMUM FIREPOWER!' : 'WEAPON UPGRADED!', color: SHIP_COLOR, duration: 1.5 }),
    gravityWell: () => ({ main: "GRAVITY WELL", color: "#FF00FF", duration: 2 }),
    repulsionField: () => ({ main: "REPULSION FIELD", color: "#00FFFF", duration: 2 }),
    fieldBombDetonation: () => ({ main: "FIELD BOMB!", color: POWERUP_COLORS.fieldBomb, duration: 2 }),    
    bonusPoints: (points) => ({ main: `+${points}`, color: "#FFFF00", duration: 1 })
};

// Level thresholds (can be adjusted for balancing)
const levelThresholds = [0, 5000, 15000, 30000, 50000, 75000, 100000]; // Normal thresholds

const testMode = false; // Set to true to enable test features like mobile controls on desktop

//=============================================================================
// GAME STATE VARIABLES
//=============================================================================
let canvas, ctx, width, height;
let score = 0;
let lives = 3;
let gameState = "title"; // "title", "playing", "gameOver", "paused"
let previousGameState = null; // For pausing
let lastTime = 0;
let stars = [];
let particles = [];
let projectiles = [];
let asteroids = [];
let powerups = [];
let gravityFields = [];
let dangerZones = [];
let bonusTargets = [];
let player;
let keys = {}; // Keyboard state
let highScore = 0;
let screenShake = 0;
let gameLevel = 1;
let scoreMultiplier = 1;
let scoreDisplay = 0; // For animated score display
let asteroidSpawnTimer = 0;
let weaponLevel = 1;
let meteorShowerActive = false;
let meteorShowerTimer = 0;
let meteorShowerDuration = 0;
let bonusRoundActive = false;
let bonusRoundTimer = 0;
let bonusRoundDuration = 0;
let bonusMultiplier = 2;
let activePowerups = {}; // Stores active powerup state (e.g., { shield: true })
let powerupTimers = {};  // Stores remaining time for timed powerups

// Mobile control state
let isMobileControlsActive = false;
let joystickActive = false;
let joystickAngle = 0;
let joystickDistance = 0;

// Audio state
let audioContext;
let soundEnabled = true;

// Fullscreen state
let fullscreenPreference = 'ask';
let hasSeenFullscreenPrompt = false;

// DOM Element References (initialized in onload)
let orientationMessageEl, fullscreenPromptEl, iosModalEl, exitFullscreenBtn,
    soundToggleBtn, fullscreenToggleBtn, restartBtn, toggleMobileBtn, // Added restartBtn back
    mobileControlsEl, joystickBaseEl, joystickHandleEl, fireButtonEl,
    upArrowEl, downArrowEl, leftArrowEl, rightArrowEl;

//=============================================================================
// UTILITY FUNCTIONS
//=============================================================================

/** Checks if likely running on a mobile device */
function isMobileDevice() {
    // Check user agent and touch points (more reliable for iPadOS)
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Checks if likely running on an iOS device */
function isIOSDevice() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !window.MSStream); // Exclude Surface Duo
}

/** Wraps object position around screen edges */
function wrap(obj) {
    const buffer = 50; // Allow objects to go slightly off-screen before wrapping
    if (obj.x < -buffer) obj.x = width + buffer;
    else if (obj.x > width + buffer) obj.x = -buffer;
    if (obj.y < -buffer) obj.y = height + buffer;
    else if (obj.y > height + buffer) obj.y = -buffer;
}

/** Basic circle collision detection */
function circleCollision(x1, y1, r1, x2, y2, r2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    const distanceSq = dx * dx + dy * dy;
    const radiusSum = r1 + r2;
    return distanceSq < radiusSum * radiusSum;
}

/** Converts hex color to RGB string "r, g, b" */
function hexToRgb(hex) {
    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255'; // Default to white on error
}

/** Gets a complementary color (simple inversion) */
function getComplementaryColor(hex) {
    try {
        if (hex.startsWith('#')) hex = hex.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const rComp = (255 - r).toString(16).padStart(2, '0');
        const gComp = (255 - g).toString(16).padStart(2, '0');
        const bComp = (255 - b).toString(16).padStart(2, '0');
        return `#${rComp}${gComp}${bComp}`;
    } catch (e) {
        return "#FFFFFF"; // Default on error
    }
}

//=============================================================================
// GAME OBJECT CLASSES
//=============================================================================

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.angle = -Math.PI / 2; // Start facing up
        this.vx = 0; // velocityX
        this.vy = 0; // velocityY
        this.thrusting = false;
        this.turnSpeed = 5; // Radians per second
        this.thrustPower = 200; // Acceleration
        this.drag = 0.98; // Velocity multiplier per frame (closer to 1 = less drag)
        this.alive = true;
        this.invulnerable = true; // Start invulnerable
        this.invulnerabilityTimer = 3; // Seconds
        this.shootTimer = 0;
        this.maxSpeed = 350; // Maximum pixels per second
        this.shielded = false; // Controlled by powerup
        this.fireRateMultiplier = 1; // For rapid fire powerup
        this.weaponCountMultiplier = 1; // For double shot powerup
        this.currentJoystickDistance = 0; // For mobile adaptive drag
    }

    update(deltaTime) {
        // Invulnerability
        if (this.invulnerable) {
            this.invulnerabilityTimer -= deltaTime;
            if (this.invulnerabilityTimer <= 0) {
                this.invulnerable = false;
            }
        }

        // Shooting cooldown
        if (this.shootTimer > 0) {
            this.shootTimer -= deltaTime;
        }

        // --- Input Handling ---
        this.thrusting = false; // Reset thrusting state each frame

        if (joystickActive) {
            // Mobile Joystick Control (overrides keyboard for movement/aiming)
            if (joystickDistance > 10) { // Dead zone
                // Visually point ship in joystick direction
                this.angle = joystickAngle;
                this.thrusting = true;

                // Calculate thrust power based on joystick distance (0 to 1)
                const thrustMagnitude = Math.min(joystickDistance / 60, 1); // Normalize distance

                // Apply thrust in joystick direction
                this.vx += Math.cos(this.angle) * this.thrustPower * thrustMagnitude * deltaTime;
                this.vy += Math.sin(this.angle) * this.thrustPower * thrustMagnitude * deltaTime;

                this.currentJoystickDistance = joystickDistance;
            } else {
                this.currentJoystickDistance = 0; // No joystick input, apply normal drag later
            }
        } else {
            // Keyboard Control
            if (keys["ArrowLeft"]) {
                this.angle -= this.turnSpeed * deltaTime;
            }
            if (keys["ArrowRight"]) {
                this.angle += this.turnSpeed * deltaTime;
            }
            if (keys["ArrowUp"]) {
                this.thrusting = true;
                this.vx += Math.cos(this.angle) * this.thrustPower * deltaTime;
                this.vy += Math.sin(this.angle) * this.thrustPower * deltaTime;
            }
            this.currentJoystickDistance = 0; // Not using joystick
        }

        // Shooting (Common for both control schemes)
        if (keys[" "] && this.shootTimer <= 0) {
            this.shoot();
        }

        // --- Physics ---
        // Apply drag (adaptive for joystick)
        let currentDrag = this.drag;
        if (joystickActive && this.currentJoystickDistance > 10) {
            // Reduce drag slightly when joystick is active and extended
            const dragReductionFactor = Math.min(this.currentJoystickDistance / 120, 0.5); // Max 50% reduction
            currentDrag = this.drag + dragReductionFactor * (1 - this.drag); // Interpolate towards 1 (no drag)
            // Ensure drag doesn't exceed 1
            currentDrag = Math.min(currentDrag, 0.995); // Give it a tiny bit of drag always
        }
        this.vx *= currentDrag;
        this.vy *= currentDrag;


        // Limit speed
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (speed > this.maxSpeed) {
            const scale = this.maxSpeed / speed;
            this.vx *= scale;
            this.vy *= scale;
        }

        // Update position
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;

        // Screen wrap
        wrap(this);

        // --- Effects ---
        // Create thruster particles only if actually thrusting
        if (this.thrusting && Math.random() < 0.4) { // Slightly increased chance
            const particleAngle = this.angle + Math.PI + (Math.random() - 0.5) * 0.5; // Opposite direction + spread
            const particleSpeed = Math.random() * 50 + 30;
            const particleX = this.x - Math.cos(this.angle) * (SHIP_SIZE * 0.6); // Emitter behind center
            const particleY = this.y - Math.sin(this.angle) * (SHIP_SIZE * 0.6);
            particles.push(new Particle(
                particleX, particleY,
                this.vx + Math.cos(particleAngle) * particleSpeed, // Add ship velocity for realism
                this.vy + Math.sin(particleAngle) * particleSpeed,
                Math.random() * 2 + 1,
                Math.random() > 0.5 ? "#FF5500" : "#FFFF00", // Orange/Yellow
                0.4 // Shorter life
            ));
        }
    }

    shoot() {
        playSound('shoot');

        // Adjust fire rate based on powerup
        const baseFireRate = 0.3;
        this.shootTimer = baseFireRate / this.fireRateMultiplier;

        const projectileSpeed = 450; // Slightly faster projectiles
        const noseOffset = SHIP_SIZE * 0.8; // Position projectiles slightly ahead

        const startX = this.x + Math.cos(this.angle) * noseOffset;
        const startY = this.y + Math.sin(this.angle) * noseOffset;

        // Base velocity from ship + projectile velocity
        const baseVx = this.vx * 0.5; // Inherit some ship velocity
        const baseVy = this.vy * 0.5;
        const projVx = Math.cos(this.angle) * projectileSpeed;
        const projVy = Math.sin(this.angle) * projectileSpeed;

        const effectiveWeaponLevel = weaponLevel * this.weaponCountMultiplier; // Combine base level and powerup

        if (effectiveWeaponLevel === 1) {
            projectiles.push(new Projectile(startX, startY, baseVx + projVx, baseVy + projVy));
        } else if (effectiveWeaponLevel === 2) {
            const spread = 0.12; // Radians
            projectiles.push(new Projectile(startX, startY, baseVx + Math.cos(this.angle - spread) * projectileSpeed, baseVy + Math.sin(this.angle - spread) * projectileSpeed));
            projectiles.push(new Projectile(startX, startY, baseVx + Math.cos(this.angle + spread) * projectileSpeed, baseVy + Math.sin(this.angle + spread) * projectileSpeed));
        } else { // Level 3 or higher (Double Shot + Level 2/3)
            const spread = 0.18;
            projectiles.push(new Projectile(startX, startY, baseVx + projVx, baseVy + projVy)); // Center shot
            projectiles.push(new Projectile(startX, startY, baseVx + Math.cos(this.angle - spread) * projectileSpeed, baseVy + Math.sin(this.angle - spread) * projectileSpeed));
            projectiles.push(new Projectile(startX, startY, baseVx + Math.cos(this.angle + spread) * projectileSpeed, baseVy + Math.sin(this.angle + spread) * projectileSpeed));
            // Add more shots for higher effective levels if desired
            if (effectiveWeaponLevel >= 4) { // e.g. Level 2 + Double Shot
                const widerSpread = 0.3;
                projectiles.push(new Projectile(startX, startY, baseVx + Math.cos(this.angle - widerSpread) * projectileSpeed, baseVy + Math.sin(this.angle - widerSpread) * projectileSpeed));
                projectiles.push(new Projectile(startX, startY, baseVx + Math.cos(this.angle + widerSpread) * projectileSpeed, baseVy + Math.sin(this.angle + widerSpread) * projectileSpeed));
            }
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // Blinking effect when invulnerable
        const visible = !this.invulnerable || Math.floor(Date.now() / 100) % 2 === 0;

        if (visible) {
            // Draw Shield first (if active)
            if (this.shielded) {
                ctx.beginPath();
                ctx.arc(0, 0, SHIP_SIZE * 1.1, 0, Math.PI * 2); // Slightly larger shield
                ctx.strokeStyle = POWERUP_COLORS.shield;
                ctx.lineWidth = 2.5;
                ctx.shadowColor = POWERUP_COLORS.shield;
                ctx.shadowBlur = 15;
                ctx.stroke();
                ctx.shadowBlur = 0; // Reset shadow for ship
            }

            // Draw Ship Body
            ctx.beginPath();
            ctx.moveTo(SHIP_SIZE * 0.8, 0); // Nose
            ctx.lineTo(-SHIP_SIZE * 0.5, -SHIP_SIZE * 0.5); // Top-left wing
            ctx.lineTo(-SHIP_SIZE * 0.3, 0); // Mid-back indentation
            ctx.lineTo(-SHIP_SIZE * 0.5, SHIP_SIZE * 0.5); // Bottom-left wing
            ctx.closePath();

            ctx.strokeStyle = SHIP_COLOR;
            ctx.lineWidth = 2;
            ctx.fillStyle = `rgba(${hexToRgb(SHIP_COLOR)}, 0.1)`; // Subtle fill

            // Apply glow before drawing
            ctx.shadowColor = SHIP_COLOR;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.fill();
            ctx.shadowBlur = 0; // Reset shadow


            // Draw Thruster Flame if thrusting
            if (this.thrusting) {
                ctx.beginPath();
                const flameLength = SHIP_SIZE * (0.8 + Math.random() * 0.4); // Variable length
                ctx.moveTo(-SHIP_SIZE * 0.3, 0); // Start at back indentation
                ctx.lineTo(-SHIP_SIZE * 0.3 - flameLength, 0);

                // Use yellow/orange gradient for flame
                const flameGrad = ctx.createLinearGradient(-SHIP_SIZE * 0.3, 0, -SHIP_SIZE * 0.3 - flameLength, 0);
                flameGrad.addColorStop(0, "#FFFF00"); // Yellow base
                flameGrad.addColorStop(1, "#FF5500"); // Orange tip

                ctx.strokeStyle = flameGrad;
                ctx.lineWidth = 3 + Math.random(); // Flickering width
                ctx.shadowColor = "#FF5500";
                ctx.shadowBlur = 10;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
        }

        ctx.restore();
    }
}

class Projectile {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.lifespan = 1.2; // Slightly shorter lifespan
        this.radius = 3;
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.lifespan -= deltaTime;
        wrap(this); // Wrap projectiles
    }

    draw() {
        ctx.save();
        ctx.fillStyle = PROJECTILE_COLOR;
        ctx.shadowColor = PROJECTILE_COLOR;
        ctx.shadowBlur = 12; // Enhanced glow

        // Draw core dot
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Draw subtle trail
        const trailLengthFactor = 0.05; // Adjust for trail length relative to velocity
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - this.vx * trailLengthFactor, this.y - this.vy * trailLengthFactor);
        ctx.strokeStyle = `rgba(${hexToRgb(PROJECTILE_COLOR)}, 0.6)`; // Semi-transparent trail
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    }
}

class Asteroid {
    constructor(x, y, size, angle, speedMultiplier = 1, isMeteor = false) {
        this.x = x;
        this.y = y;
        this.size = size; // 0: Large, 1: Medium, 2: Small, 3: Tiny
        this.angle = angle;
        this.isMeteor = isMeteor;
        this.hasTrail = isMeteor; // Meteors have trails

        // Size and Speed setup
        const sizeRadii = [60, 40, 25, 15]; // Large, Medium, Small, Tiny
        const baseSpeeds = [60, 80, 110, 140]; // Larger = slower
        this.radius = sizeRadii[size] || 15; // Default to tiny if size is invalid
        const baseSpeed = (isMeteor ? 250 : baseSpeeds[size]) || 140;
        const speed = baseSpeed * speedMultiplier * (0.8 + Math.random() * 0.4); // Add randomness

        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;

        // Rotation
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * (isMeteor ? 4 : 2); // Faster rotation for meteors

        // Shape Generation (jaggedness)
        this.vertices = [];
        const numVertices = Math.floor(Math.random() * 5) + 7; // 7-11 vertices
        const jaggedness = 0.3; // How much vertex distance varies (0-1)
        for (let i = 0; i < numVertices; i++) {
            const vertexAngle = (i / numVertices) * Math.PI * 2;
            const distance = this.radius * (1 + (Math.random() - 0.5) * 2 * jaggedness);
            this.vertices.push({
                x: Math.cos(vertexAngle) * distance,
                y: Math.sin(vertexAngle) * distance
            });
        }
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.rotation += this.rotationSpeed * deltaTime;

        // Meteor Trail
        if (this.hasTrail && Math.random() < 0.5) { // More frequent trail
            particles.push(new Particle(
                this.x, this.y,
                this.vx * -0.05, this.vy * -0.05, // Slight backward drift
                Math.random() * 1.5 + 0.5, // Smaller trail particles
                this.isMeteor ? "#FF5500" : ASTEROID_COLOR, // Orange for meteors
                0.3 + Math.random() * 0.2 // Short life
            ));
        }

        wrap(this);
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        ctx.beginPath();
        ctx.moveTo(this.vertices[0].x, this.vertices[0].y);
        for (let i = 1; i < this.vertices.length; i++) {
            ctx.lineTo(this.vertices[i].x, this.vertices[i].y);
        }
        ctx.closePath();

        ctx.strokeStyle = this.isMeteor ? "#FFA500" : ASTEROID_COLOR; // Orange outline for meteors
        ctx.lineWidth = 1.5;
        ctx.fillStyle = `rgba(${hexToRgb(ASTEROID_COLOR)}, ${this.isMeteor ? 0.05 : 0.1})`; // Very subtle fill

        ctx.stroke();
        ctx.fill();

        ctx.restore();
    }
}

class Particle {
    constructor(x, y, vx, vy, size, color, life) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.size = size;
        this.color = color;
        this.life = life;
        this.initialLife = life; // Store initial life for alpha calculation
        this.drag = 0.99; // Add slight drag to particles
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.vx *= this.drag; // Apply drag
        this.vy *= this.drag;
        this.life -= deltaTime;
        // Shrink particle over time
        this.size = Math.max(0, this.size * (this.life / this.initialLife));
    }

    draw() {
        if (this.life <= 0 || this.size <= 0.1) return; // Don't draw dead/tiny particles

        const alpha = Math.max(0, this.life / this.initialLife); // Fade out
        // Try/catch block for safety with potentially invalid colors during effects
        try {
            ctx.fillStyle = this.color; // Assuming color is valid CSS color string
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            // Or keep circles if preferred:
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } catch (e) {
            ctx.fillStyle = "#FFFFFF"; // Fallback to white
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } finally {
            ctx.globalAlpha = 1.0; // Reset global alpha
        }
    }
}

class TextParticle extends Particle { // Inherit position, velocity, life
    constructor(x, y, text, color, life) {
        super(x, y, 0, -40, 0, color, life); // Move upwards, size not used directly
        this.text = text;
        this.fontSize = 20; // Base font size
    }

    update(deltaTime) {
        super.update(deltaTime); // Update position and life
        // Optional: Shrink font size over time
        this.fontSize = Math.max(5, 20 * (this.life / this.initialLife));
    }

    draw() {
        if (this.life <= 0) return;

        const alpha = Math.max(0, this.life / this.initialLife);
        try {
            ctx.fillStyle = this.color;
            ctx.globalAlpha = alpha;
            ctx.font = `bold ${Math.round(this.fontSize)}px ${DEFAULT_FONT}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle"; // Vertically center
            ctx.fillText(this.text, this.x, this.y);
        } catch (e) {
            ctx.fillStyle = "#FFFFFF"; // Fallback
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

class Powerup {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.radius = 12;
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 20; // Slow drift
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.rotation = 0;
        this.rotationSpeed = (Math.random() - 0.5) * 2; // Radians per second
        this.lifespan = 12; // Seconds
        this.initialLife = 12;
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.rotation += this.rotationSpeed * deltaTime;
        this.lifespan -= deltaTime;
        wrap(this);
    }

    draw() {
        if (this.lifespan <= 0) return;

        // Blinking effect when about to disappear
        const blinkSpeed = 150; // Milliseconds per blink cycle
        const isVisible = this.lifespan > 3 || Math.floor(Date.now() / blinkSpeed) % 2 === 0;

        if (isVisible) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);

            const color = POWERUP_CONFIG[this.type].color || '#FFFFFF';
            const rgb = hexToRgb(color);

            ctx.strokeStyle = color;
            ctx.fillStyle = `rgba(${rgb}, 0.3)`;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10 + 5 * Math.abs(Math.sin(Date.now() / 200)); // Pulsing glow

            // Draw shape based on type
            ctx.beginPath();
            switch (this.type) {
                case 'shield':
                    // Simple circle for shield
                    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
                    // Add cross inside
                    ctx.moveTo(-this.radius * 0.6, 0); ctx.lineTo(this.radius * 0.6, 0);
                    ctx.moveTo(0, -this.radius * 0.6); ctx.lineTo(0, this.radius * 0.6);
                    break;
                case 'rapidFire':
                    // Simple lightning bolt (zigzag)
                    ctx.moveTo(0, -this.radius);
                    ctx.lineTo(this.radius * 0.5, -this.radius * 0.2);
                    ctx.lineTo(-this.radius * 0.3, this.radius * 0.3);
                    ctx.lineTo(0, this.radius);
                    break;
                case 'doubleShot':
                    // Two parallel lines
                    ctx.rect(-this.radius * 0.6, -this.radius * 0.7, this.radius * 0.4, this.radius * 1.4);
                    ctx.rect(this.radius * 0.2, -this.radius * 0.7, this.radius * 0.4, this.radius * 1.4);
                    break;
                case 'fieldBomb':
                    // Circle with smaller circle inside (like a cartoon bomb)
                    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
                    ctx.moveTo(this.radius * 0.4, 0); // Move inside without drawing
                    ctx.arc(0, 0, this.radius * 0.4, 0, Math.PI * 2); // Inner circle
                    break;
                default:
                    // Default square
                    ctx.rect(-this.radius, -this.radius, this.radius * 2, this.radius * 2);
            }
            ctx.stroke();
            ctx.fill();

            ctx.restore();
        }
    }
}

class GravityField {
    constructor(x, y, radius, strength) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.strength = strength; // Positive = pull, negative = push
        this.lifespan = 15; // seconds
        this.initialLife = 15;
        this.active = true;
        this.pulseRate = 300; // milliseconds per pulse cycle
    }

    update(deltaTime) {
        this.lifespan -= deltaTime;
        if (this.lifespan <= 0) {
            this.active = false;
        }
    }

    applyGravity(obj, deltaTime) {
        if (!this.active) return;

        const dx = this.x - obj.x;
        const dy = this.y - obj.y;
        const distSq = dx * dx + dy * dy;
        const radiusSq = this.radius * this.radius;

        if (distSq < radiusSq && distSq > 1) { // Avoid division by zero / extreme force at center
            const distance = Math.sqrt(distSq);
            // Force falls off quadratically with distance from edge (stronger near center)
            const falloff = Math.pow(1 - (distance / this.radius), 2);
            const baseForce = 2500; // Adjusted base force
            const forceMagnitude = this.strength * falloff * baseForce * deltaTime / distance; // Divide by distance for 1/r falloff

            // Apply force (normalized direction * magnitude)
            obj.vx += (dx / distance) * forceMagnitude;
            obj.vy += (dy / distance) * forceMagnitude;

        }
    }

    draw() {
        if (!this.active) return;

        const pulse = 0.9 + 0.1 * Math.sin(Date.now() / this.pulseRate);
        const currentRadius = this.radius * pulse;
        const alpha = Math.min(1, this.lifespan / 5) * 0.4; // Fade out last 5 seconds, max alpha 0.4

        const color = this.strength > 0 ? `rgba(255, 0, 255, ${alpha})` : `rgba(0, 255, 255, ${alpha})`; // Magenta pull, Cyan push
        const edgeColor = this.strength > 0 ? `rgba(255, 0, 255, ${alpha * 0.1})` : `rgba(0, 255, 255, ${alpha * 0.1})`;

        ctx.save();
        const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, currentRadius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.7, color); // Stronger color further out
        gradient.addColorStop(1, edgeColor);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();

        // Blinking border when fading
        if (this.lifespan < 3 && Math.floor(Date.now() / 150) % 2 === 0) {
            ctx.strokeStyle = this.strength > 0 ? "#FF00FF" : "#00FFFF";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    }
}

class DangerZone {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.lifespan = 10; // Total duration
        this.warningTime = 2; // Seconds of warning before active damage
        this.active = true;
        this.damageInterval = 0.5; // Seconds between damage ticks
        this.damageTimer = 0;
    }

    update(deltaTime) {
        this.lifespan -= deltaTime;
        if (this.lifespan <= 0) {
            this.active = false;
        }
        if (this.damageTimer > 0) {
            this.damageTimer -= deltaTime;
        }
    }

    checkCollision(obj) {
        // Check only if active, past warning time, and damage timer ready
        if (!this.active || this.lifespan > (10 - this.warningTime) || this.damageTimer > 0) {
            return false;
        }

        // Simple AABB collision check
        if (obj.x > this.x && obj.x < this.x + this.width &&
            obj.y > this.y && obj.y < this.y + this.height) {
            this.damageTimer = this.damageInterval; // Reset timer after hit
            return true;
        }
        return false;
    }

    draw() {
        if (!this.active) return;

        const isWarning = this.lifespan > (10 - this.warningTime);
        const baseAlpha = 0.25;
        const pulseAlpha = baseAlpha + 0.15 * Math.abs(Math.sin(Date.now() / (isWarning ? 200 : 400)));
        const color = isWarning ? `rgba(255, 255, 0, ${pulseAlpha})` : `rgba(255, 0, 0, ${pulseAlpha})`; // Yellow warning, Red active

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
}

class BonusTarget {
    constructor(x, y, points) {
        this.x = x;
        this.y = y;
        this.points = points;
        this.radius = 18; // Slightly larger
        this.lifespan = 6 + Math.random() * 4; // 6-10 seconds
        this.initialLife = this.lifespan;
        this.angle = 0;
        this.rotationSpeed = (Math.random() - 0.5) * 4; // Faster rotation

        const speed = 40 + Math.random() * 40; // Slightly faster movement
        const moveAngle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(moveAngle) * speed;
        this.vy = Math.sin(moveAngle) * speed;

        // Color based on points
        this.color = points === 100 ? "#FFFF00" : (points === 200 ? "#FF00FF" : "#00FFFF");
        this.rgb = hexToRgb(this.color);
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.angle += this.rotationSpeed * deltaTime;
        this.lifespan -= deltaTime;

        // Bounce off edges
        if (this.x < this.radius && this.vx < 0 || this.x > width - this.radius && this.vx > 0) {
            this.vx *= -1;
        }
        if (this.y < this.radius && this.vy < 0 || this.y > height - this.radius && this.vy > 0) {
            this.vy *= -1;
        }
        // Keep within bounds strictly
        this.x = Math.max(this.radius, Math.min(width - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(height - this.radius, this.y));
    }

    draw() {
        if (this.lifespan <= 0) return;

        // Blinking when near end of life
        const blinkSpeed = 100;
        const isVisible = this.lifespan > 2 || Math.floor(Date.now() / blinkSpeed) % 2 === 0;

        if (isVisible) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);

            const pulse = 1 + 0.1 * Math.sin(Date.now() / 150); // Pulsing size
            const currentRadius = this.radius * pulse;

            // Star shape
            const spikes = 5;
            const outerRadius = currentRadius;
            const innerRadius = currentRadius * 0.5;

            ctx.beginPath();
            for (let i = 0; i < spikes * 2; i++) {
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const vertexAngle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2; // Start pointing up
                const vx = Math.cos(vertexAngle) * radius;
                const vy = Math.sin(vertexAngle) * radius;
                if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
            }
            ctx.closePath();

            ctx.strokeStyle = this.color;
            ctx.fillStyle = `rgba(${this.rgb}, 0.4)`;
            ctx.lineWidth = 2;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 15;

            ctx.stroke();
            ctx.fill();

            // Draw points value inside
            ctx.shadowBlur = 0; // No shadow for text
            ctx.fillStyle = "#FFFFFF";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `bold ${Math.round(this.radius * 0.8)}px ${DEFAULT_FONT}`; // Scale font size
            ctx.fillText(this.points, 0, 0);

            ctx.restore();
        }
    }
}

// New class for the field bomb explosion effect radius
class BlastRadiusParticle extends Particle {
    constructor(x, y, maxRadius, delay) {
        super(x, y, 0, 0, 0, POWERUP_COLORS.fieldBomb, 0.8); // Short life for the ring pulse
        this.maxRadius = maxRadius;
        this.currentRadius = 0;
        this.delay = delay; // Start delay
    }

    update(deltaTime) {
        if (this.delay > 0) {
            this.delay -= deltaTime;
            return;
        }
        super.update(deltaTime); // Decrease life
        if (this.life > 0) {
            // Expand radius rapidly then fade
            this.currentRadius = this.maxRadius * (1 - this.life / this.initialLife);
        }
    }

    draw() {
        if (this.delay > 0 || this.life <= 0) return;

        const alpha = Math.max(0, this.life / this.initialLife); // Fade out
        ctx.save();
        ctx.strokeStyle = `rgba(${hexToRgb(this.color)}, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}


//=============================================================================
// CORE GAME LOGIC
//=============================================================================

/** Main game loop */
function gameLoop(timestamp) {
    // Calculate delta time
    let deltaTime = (timestamp - lastTime) / 1000; // Delta time in seconds
    lastTime = timestamp;

    // Cap delta time to prevent large jumps (e.g., after tab switching)
    deltaTime = Math.min(deltaTime, 0.1); // Max 100ms step

    if (gameState !== "paused") {
        update(deltaTime);
    }
    render();

    requestAnimationFrame(gameLoop); // Continue the loop
}

/** Update game state */
function update(deltaTime) {
    if (gameState !== "playing") return; // Only update when playing

    // Update Player
    player.update(deltaTime);

    // Update Score Display Animation
    if (scoreDisplay < score) {
        scoreDisplay = Math.min(score, scoreDisplay + Math.ceil((score - scoreDisplay) * deltaTime * 8)); // Faster score animation
    } else if (scoreDisplay > score) {
        scoreDisplay = score; // Snap down if score somehow decreased (unlikely)
    }

    // Update Entities (Iterate backwards for safe removal)
    [projectiles, asteroids, particles, powerups, gravityFields, dangerZones, bonusTargets].forEach(arr => {
        for (let i = arr.length - 1; i >= 0; i--) {
            arr[i].update(deltaTime);
            // Check lifespan or active status for removal
            if (arr[i].lifespan !== undefined && arr[i].lifespan <= 0) {
                arr.splice(i, 1);
            } else if (arr[i].active !== undefined && !arr[i].active) {
                arr.splice(i, 1);
            }
        }
    });

    // Apply Gravity Fields to relevant objects
    gravityFields.forEach(field => {
        if (player.alive) field.applyGravity(player, deltaTime);
        projectiles.forEach(p => field.applyGravity(p, deltaTime));
        asteroids.forEach(a => field.applyGravity(a, deltaTime));
    });

    // Check Collisions
    checkCollisions();

    // Update Powerup Timers & Effects
    updateActivePowerups(deltaTime);

    // Spawning Logic
    handleSpawning(deltaTime);

    // Event Logic (Meteor Shower, Bonus Round)
    handleGameEvents(deltaTime);

    // Level Progression Check
    checkLevelProgression();

    // Weapon Upgrade Check
    checkWeaponUpgrade();

    // Screen Shake Decay
    if (screenShake > 0) {
        screenShake = Math.max(0, screenShake - deltaTime * 4); // Faster decay
    }
}

/** Render game objects and UI */
function render() {
    // Clear canvas (assuming black background is set in CSS/body)
    ctx.clearRect(0, 0, width, height); // Use clearRect for potential transparency later

    // Apply Screen Shake
    if (screenShake > 0 && gameState === "playing") {
        ctx.save();
        const shakeX = (Math.random() - 0.5) * screenShake * 15; // Increased intensity
        const shakeY = (Math.random() - 0.5) * screenShake * 15;
        ctx.translate(shakeX, shakeY);
    }

    // Draw Stars (Background)
    ctx.fillStyle = "#FFFFFF"; // Default star color
    stars.forEach(star => {
        ctx.fillStyle = star.color; // Use individual star color
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Game Elements based on State
    if (gameState === "title") {
        drawTitleScreen();
    } else if (gameState === "playing") {
        // Draw in order: zones -> fields -> asteroids -> powerups -> player -> projectiles -> particles -> UI
        dangerZones.forEach(z => z.draw());
        gravityFields.forEach(f => f.draw());
        asteroids.forEach(a => a.draw());
        powerups.forEach(p => p.draw());
        bonusTargets.forEach(t => t.draw());

        if (player.alive) {
            player.draw();
        }

        projectiles.forEach(p => p.draw());
        particles.forEach(p => p.draw()); // Draw particles last so they are on top

        drawHUD(); // Draw UI on top

    } else if (gameState === "gameOver") {
        // Optionally draw final state of asteroids/particles?
        asteroids.forEach(a => a.draw());
        particles.forEach(p => p.draw());
        drawGameOverScreen();
    }

    // Restore context if screen shake was applied
    if (screenShake > 0 && gameState === "playing") {
        ctx.restore();
    }
}

/** Starts or restarts the game */
function startGame() {
    resetGameState();
    gameState = "playing";
    player = new Player(width / 2, height / 2);

    // Initial Asteroids
    const initialAsteroidCount = 3;
    for (let i = 0; i < initialAsteroidCount; i++) {
        spawnAsteroid(true); // Spawn away from center initially
    }

    // Hide restart button if shown
    if (isMobileControlsActive && restartBtn) restartBtn.style.display = 'none';
}

/** Resets all game state variables */
function resetGameState() {
    // Directly reset global variables
    score = 0;
    scoreDisplay = 0;
    lives = 3;
    gameLevel = 1;
    scoreMultiplier = 1;
    weaponLevel = 1;
    screenShake = 0;
    asteroidSpawnTimer = 0;
    projectiles = [];
    asteroids = [];
    powerups = [];
    particles = [];
    gravityFields = [];
    dangerZones = [];
    bonusTargets = [];
    meteorShowerActive = false;
    meteorShowerTimer = 0;
    meteorShowerDuration = 0;
    bonusRoundActive = false;
    bonusRoundTimer = 0;
    bonusRoundDuration = 0;
    bonusMultiplier = 2;
    activePowerups = {};
    powerupTimers = {};

    // Explicitly reset keys and joystick state
    keys = {};
    joystickActive = false;
    if (player) player.currentJoystickDistance = 0; // Reset if player exists

    // Ensure player object is cleared
    player = null;
}


//=============================================================================
// DRAWING FUNCTIONS (UI & Screens)
//=============================================================================

function drawHUD() {
    ctx.save(); // Save context state before drawing HUD
    ctx.font = `20px ${DEFAULT_FONT}`;
    ctx.textBaseline = "top"; // Align text from the top

    // Score & High Score (Top Left)
    ctx.textAlign = "left";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`SCORE: ${Math.floor(scoreDisplay)}`, 20, 60); // Y = 60
    ctx.fillStyle = "#FFFF00"; // Yellow for High Score
    ctx.fillText(`HIGH: ${highScore}`, 20, 85); // Y = 85

    // Level & Multiplier (Top Center)
    ctx.textAlign = "center";
    ctx.fillStyle = TEXT_COLOR; // Green for Level
    ctx.fillText(`LEVEL ${gameLevel}`, width / 2, 20); // Y = 20
    ctx.fillStyle = "#FF00FF"; // Magenta for Multiplier
    ctx.fillText(`MULT: ${scoreMultiplier.toFixed(1)}x`, width / 2, 45); // Y = 45

    // Lives (Top Right)
    // Text part
    ctx.textAlign = "right";
    const livesText = `LIVES: ${lives}`; // Corrected line: use 'lives' directly
    const livesTextWidth = ctx.measureText(livesText).width;
    const livesX = width - 20;
    const livesY = 85; // Y = 85 for text

    if (lives === 1) { // Corrected line: use 'lives' directly
        // Pulsing red color when low on lives
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 200));
        ctx.fillStyle = `rgba(255, 0, 0, ${pulse})`;
        ctx.shadowColor = "rgba(255,0,0,0.8)";
        ctx.shadowBlur = 10;
    } else {
        ctx.fillStyle = "#FFFFFF";
        ctx.shadowBlur = 0;
    }
    ctx.fillText(livesText, livesX, livesY);
    ctx.shadowBlur = 0; // Reset shadow

    // Ship Icons for Lives (Below Text)
    ctx.strokeStyle = SHIP_COLOR;
    ctx.lineWidth = 1.5;
    const shipIconSize = 10; // Smaller icons
    const iconSpacing = shipIconSize * 1.8;
    ctx.save();
    // Start the translation directly at the right edge coordinate 'livesX'
    ctx.translate(livesX, 65); // Y = 65 for icons
    for (let i = 0; i < lives; i++) { // Corrected line: use 'lives' directly
        ctx.beginPath();
        // Draw the icon centered around the current translation point (0,0)
        ctx.moveTo(shipIconSize * 0.8, 0); // Nose
        ctx.lineTo(-shipIconSize * 0.5, -shipIconSize * 0.5); // Top-left wing
        ctx.lineTo(-shipIconSize * 0.3, 0); // Mid-back indentation
        ctx.lineTo(-shipIconSize * 0.5, shipIconSize * 0.5); // Bottom-left wing
        ctx.closePath();
        ctx.stroke();
        // Translate left to prepare for the next icon's position
        ctx.translate(-iconSpacing, 0);
    }
    ctx.restore();


    // Active Powerups (Bottom Center)
    ctx.textAlign = "center";
    ctx.font = `16px ${DEFAULT_FONT}`;
    let powerupY = height - 30; // Start from bottom
    let count = 0;
    POWERUP_TYPES.forEach(type => {
        if (activePowerups[type] && powerupTimers[type] > 0) { // Only show timed powerups
            const config = POWERUP_CONFIG[type];
            if (!config || config.duration <= 0) return; // Skip instant or invalid

            const remainingTime = Math.ceil(powerupTimers[type]);
            let text = type.replace(/([A-Z])/g, ' $1').toUpperCase(); // Format name
            ctx.fillStyle = config.color;

            // Pulsing effect when time is low
            if (remainingTime <= 3) {
                const pulse = 0.7 + 0.3 * Math.abs(Math.sin(Date.now() / 150));
                const rgb = hexToRgb(config.color);
                ctx.fillStyle = `rgba(${rgb}, ${pulse})`;
                ctx.shadowColor = config.color;
                ctx.shadowBlur = 10;
            } else {
                ctx.shadowBlur = 0;
            }

            ctx.fillText(`${text}: ${remainingTime}s`, width / 2, powerupY - count * 20);
            count++;
            ctx.shadowBlur = 0; // Reset shadow
        }
    });

    // Bonus Round Timer (Top Center, below level/mult)
    if (bonusRoundActive) {
        ctx.font = `bold 20px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FFFF00";
        ctx.shadowColor = "#FFFF00";
        ctx.shadowBlur = 10;
        ctx.fillText(`BONUS: ${Math.ceil(bonusRoundTimer)}s`, width / 2, 70);
        ctx.shadowBlur = 0;
    }

    ctx.restore(); // Restore context state
}

function drawTitleScreen() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = TEXT_COLOR;

    // Title Text with Glow
    ctx.font = `bold 60px ${DEFAULT_FONT}`;
    ctx.shadowColor = TEXT_COLOR;
    ctx.shadowBlur = 15;
    ctx.fillText("COSMIC ASSAULT", width / 2, height * 0.3);
    ctx.fillText("COSMIC ASSAULT", width / 2, height * 0.3); // Draw twice for bolder glow
    ctx.shadowBlur = 0;

    // Instructions
    ctx.font = `20px ${DEFAULT_FONT}`;
    const instructionY = height * 0.5;
    if (isMobileControlsActive) {
        ctx.fillText("Use Joystick to Move & Aim", width / 2, instructionY);
        ctx.fillText("Press FIRE Button to Shoot", width / 2, instructionY + 30);
    } else {
        ctx.fillText("Arrow Keys to Move & Aim", width / 2, instructionY);
        ctx.fillText("Spacebar to Shoot", width / 2, instructionY + 30);
    }
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("Destroy Asteroids - Collect Powerups", width / 2, instructionY + 60);

    // High Score
    ctx.font = `24px ${DEFAULT_FONT}`;
    ctx.fillStyle = "#FFFF00"; // Yellow
    ctx.fillText(`HIGH SCORE: ${highScore}`, width / 2, instructionY + 110);

    // Start Prompt (Blinking)
    ctx.font = `28px ${DEFAULT_FONT}`;
    ctx.fillStyle = "#FFFFFF";
    const promptText = isMobileControlsActive ? "TAP SCREEN TO START" : "PRESS ANY KEY TO START";
    if (Math.floor(Date.now() / 500) % 2 === 0) { // Blink effect
        ctx.fillText(promptText, width / 2, height * 0.8);
    }

    ctx.restore();
}

function drawGameOverScreen() {
    ctx.save();
    ctx.textAlign = "center";

    // Game Over Text with Glow
    ctx.font = `bold 70px ${DEFAULT_FONT}`;
    ctx.fillStyle = "#FF0000"; // Red for Game Over
    ctx.shadowColor = "#FF0000";
    ctx.shadowBlur = 20;
    ctx.fillText("GAME OVER", width / 2, height * 0.3);
    ctx.fillText("GAME OVER", width / 2, height * 0.3);
    ctx.shadowBlur = 0;

    // Final Score
    ctx.font = `30px ${DEFAULT_FONT}`;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`FINAL SCORE: ${score}`, width / 2, height * 0.5);

    // High Score
    ctx.font = `24px ${DEFAULT_FONT}`;
    ctx.fillStyle = "#FFFF00";
    ctx.fillText(`HIGH SCORE: ${highScore}`, width / 2, height * 0.5 + 45);

    // New High Score Message
    if (score === highScore && score > 0) { // Check if the current score IS the high score
        ctx.font = `bold 28px ${DEFAULT_FONT}`;
        ctx.fillStyle = "#FF00FF"; // Magenta
        ctx.shadowColor = "#FF00FF";
        ctx.shadowBlur = 10;
        ctx.fillText("NEW HIGH SCORE!", width / 2, height * 0.5 + 90);
        ctx.shadowBlur = 0;
    }

    // Restart Prompt (Blinking)
    ctx.font = `28px ${DEFAULT_FONT}`;
    ctx.fillStyle = "#FFFFFF";
    // Show Restart Button on Mobile during Game Over
    if (isMobileControlsActive && restartBtn) restartBtn.style.display = 'block';

    const promptText = isMobileControlsActive ? "TAP RESTART BUTTON" : "PRESS 'R' TO RESTART"; // Updated mobile prompt
    if (Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.fillText(promptText, width / 2, height * 0.8);
    }

    ctx.restore();
}

//=============================================================================
// COLLISION HANDLING
//=============================================================================

function checkCollisions() {
    if (!player || !player.alive) return; // No collisions if player dead

    // 1. Player vs Asteroids
    if (!player.invulnerable) {
        for (let i = asteroids.length - 1; i >= 0; i--) {
            if (circleCollision(player.x, player.y, SHIP_SIZE / 2, asteroids[i].x, asteroids[i].y, asteroids[i].radius)) {
                if (player.shielded) {
                    // Shield absorbs hit
                    player.shielded = false; // Shield breaks
                    activePowerups.shield = false; // Update state
                    powerupTimers.shield = 0;
                    createEffect('shieldHit', player.x, player.y, { size: asteroids[i].radius }); // Use shield hit effect
                    breakAsteroid(i); // Break asteroid
                } else {
                    // Player takes damage
                    playerHit();
                    createEffect('explosion', player.x, player.y, { size: 30, color: SHIP_COLOR }); // Player explosion
                    breakAsteroid(i); // Break asteroid that hit player
                }
                // Important: break because player state changed (hit or lost shield)
                break;
            }
        }
        // After checking asteroids, re-check if player is still alive before checking zones
        if (!player.alive) return;
    }

    // 2. Player vs Danger Zones
    if (!player.invulnerable && !player.shielded) { // Shield doesn't protect from zones? Or should it? Decision needed. Let's say it doesn't.
        for (let i = dangerZones.length - 1; i >= 0; i--) {
            if (dangerZones[i].checkCollision(player)) {
                playerHit();
                showNotification('dangerZone', player.x, player.y - 30);
                createEffect('explosion', player.x, player.y, { size: 15, color: '#FF0000', shake: 0.1, sound: null }); // Small hit effect
                break; // Player was hit, stop checking zones for this frame
            }
        }
        if (!player.alive) return; // Re-check after zone check
    }


    // 3. Player vs Powerups
    for (let i = powerups.length - 1; i >= 0; i--) {
        if (circleCollision(player.x, player.y, SHIP_SIZE / 2, powerups[i].x, powerups[i].y, powerups[i].radius)) {
            activatePowerup(powerups[i].type);
            powerups.splice(i, 1); // Remove collected powerup
            // Notification is handled in activatePowerup
        }
    }

    // 4. Projectiles vs Asteroids
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let projectileHit = false;
        let pointsToAdd = 0; // Accumulate points for this projectile
        for (let j = asteroids.length - 1; j >= 0; j--) {
            if (circleCollision(projectiles[i].x, projectiles[i].y, projectiles[i].radius, asteroids[j].x, asteroids[j].y, asteroids[j].radius)) {
                // Calculate score for this asteroid
                const points = calculateAsteroidScore(asteroids[j].size);
                pointsToAdd += Math.floor(points * scoreMultiplier * (bonusRoundActive ? bonusMultiplier : 1));

                // Create explosion effect at asteroid location
                createEffect('explosion', asteroids[j].x, asteroids[j].y, { size: asteroids[j].radius });

                // Break the asteroid
                breakAsteroid(j);

                projectileHit = true;
            }
        }
        if (projectileHit) {
            // Add the accumulated points for this projectile
            score += pointsToAdd;
            projectiles.splice(i, 1); // Remove projectile
        }
        if (projectileHit) continue; // Move to next projectile if this one hit

        // 5. Projectiles vs Bonus Targets (only if bonus round active)
        if (bonusRoundActive) {
            for (let k = bonusTargets.length - 1; k >= 0; k--) {
                if (circleCollision(projectiles[i].x, projectiles[i].y, projectiles[i].radius, bonusTargets[k].x, bonusTargets[k].y, bonusTargets[k].radius)) {
                    const points = bonusTargets[k].points * bonusMultiplier;
                    score += points;
                    showNotification('bonusPoints', bonusTargets[k].x, bonusTargets[k].y - 20, points);
                    createEffect('powerup', bonusTargets[k].x, bonusTargets[k].y); // Reuse powerup effect

                    bonusTargets.splice(k, 1); // Remove target
                    projectiles.splice(i, 1); // Remove projectile
                    projectileHit = true;
                    break; // Projectile is gone
                }
            }
        }
        if (projectileHit) continue; // Move to next projectile if it hit a bonus target
    }

}

/** Handles player taking a hit */
function playerHit() {
    if (player.invulnerable) return; // Can't get hit if invulnerable

    lives--; // Update game state lives using local variable
    screenShake = 0.8; // Stronger shake on hit

    if (lives <= 0) {
        // Game Over
        player.alive = false;
        gameState = "gameOver";
        playSound('gameover');
        checkHighScore(); // Check/Save high score on game over
        if (isMobileControlsActive && restartBtn) restartBtn.style.display = 'block'; // Show button on mobile game over
    } else {
        // Respawn logic (invulnerability)
        player.invulnerable = true;
        player.invulnerabilityTimer = 3; // Reset timer
        // Reset player position and velocity
        player.x = width / 2;
        player.y = height / 2;
        player.vx = 0;
        player.vy = 0;
        playSound('explosion'); // Play a hit sound
    }
}

/** Breaks an asteroid, potentially spawning smaller ones and powerups */
function breakAsteroid(index) {
    const asteroid = asteroids[index];
    if (!asteroid) return; // Safety check

    // Spawn smaller asteroids if the broken one wasn't the smallest size
    if (asteroid.size < 3) { // 0, 1, 2 break into smaller
        const numFragments = 2;
        for (let i = 0; i < numFragments; i++) {
            // Add slight velocity variation to fragments
            const angleOffset = (Math.random() - 0.5) * 1.5;
            const speedBoost = 1 + Math.random() * 0.3;
            asteroids.push(new Asteroid(
                asteroid.x, asteroid.y,
                asteroid.size + 1, // Next size down
                asteroid.angle + angleOffset,
                speedBoost, // Add speed multiplier if needed, passing 1 for now
                asteroid.isMeteor // Fragments of meteors are still meteors? Or normal? Decide.
            ));
        }
    }

    // Chance to spawn a powerup
    const powerupChance = Math.max(minPowerupChance, basePowerupChance - (gameLevel - 1) * levelReduction);
    if (Math.random() < powerupChance) {
        spawnPowerup(asteroid.x, asteroid.y);
    }

    // Remove original asteroid
    asteroids.splice(index, 1);
}

/** Calculates score based on asteroid size */
function calculateAsteroidScore(size) {
    // Base scores: Large=20, Medium=50, Small=100, Tiny=150?
    const baseScores = [20, 50, 100, 150];
    return baseScores[size] || 10; // Default score if size is invalid
}


//=============================================================================
// POWERUP HANDLING
//=============================================================================

function activatePowerup(type) {
    const config = POWERUP_CONFIG[type];
    if (!config) return;

    playSound('powerup');
    showNotification('powerupCollected', player.x, player.y - 30, type);

    // Apply instant effect for field bomb
    if (type === "fieldBomb") {
        createFieldBombExplosion();
        return; // No timer needed
    }

    // Apply timed effects
    activePowerups[type] = true;
    powerupTimers[type] = config.duration;

    // Apply specific effect modifiers
    switch (type) {
        case 'doubleShot':
            player.weaponCountMultiplier = 2;
            break;
        case 'rapidFire':
            player.fireRateMultiplier = 2;
            break;
        case 'shield':
            player.shielded = true;
            break;
    }
    // Visual effect for collecting powerup
    createEffect('powerup', player.x, player.y, { color: config.color });
}

function updateActivePowerups(deltaTime) {
    let powerupExpired = false;
    for (const type in powerupTimers) {
        if (activePowerups[type] && powerupTimers[type] > 0) {
            powerupTimers[type] -= deltaTime;
            if (powerupTimers[type] <= 0) {
                // Powerup expired, clean up effects
                activePowerups[type] = false;
                powerupExpired = true;
                switch (type) {
                    case 'doubleShot': player.weaponCountMultiplier = 1; break;
                    case 'rapidFire': player.fireRateMultiplier = 1; break;
                    case 'shield': player.shielded = false; break;
                }
            }
        }
    }
}

//=============================================================================
// SPAWNING LOGIC
//=============================================================================

function handleSpawning(deltaTime) {
    // Asteroid Spawning (only if not in bonus round)
    if (!bonusRoundActive) {
        asteroidSpawnTimer -= deltaTime;
        const baseSpawnInterval = 3.5;
        const levelSpawnFactor = 0.3;
        const minSpawnInterval = 0.5;
        const currentSpawnInterval = Math.max(minSpawnInterval, baseSpawnInterval - (gameLevel - 1) * levelSpawnFactor);

        if (asteroidSpawnTimer <= 0) {
            spawnAsteroid();
            asteroidSpawnTimer = currentSpawnInterval;
        }

        // Ensure minimum number of asteroids based on level
        const minAsteroids = 2 + Math.floor(gameLevel * 1.2);
        if (asteroids.length < minAsteroids) {
            spawnAsteroid(true); // Spawn away from player if enforcing minimum
        }
    }

    // Gravity Field Spawning (Starts at level 2)
    if (gameLevel >= 2 && gravityFields.length < 2 && Math.random() < (0.001 + (gameLevel - 2) * 0.0005) * (60 * deltaTime)) { // Chance per second increases slightly with level
        spawnGravityField();
    }

    // Danger Zone Spawning (Starts at level 5)
    if (gameLevel >= 5 && dangerZones.length < 2 && Math.random() < (0.002 + (gameLevel - 5) * 0.0008) * (60 * deltaTime)) { // Chance per second
        spawnDangerZone();
    }

    // Bonus Target Spawning (Only during bonus round)
    if (bonusRoundActive && bonusTargets.length < (8 + gameLevel) && Math.random() < 0.1 * (60 * deltaTime)) { // High chance during bonus
        spawnBonusTarget();
    }
}


/** Spawns an asteroid off-screen */
function spawnAsteroid(awayFromPlayer = false) {
    let x, y;
    const edgeMargin = 100; // How far off-screen to spawn

    // Pick a random edge (0: top, 1: right, 2: bottom, 3: left)
    const edge = Math.floor(Math.random() * 4);

    switch (edge) {
        case 0: x = Math.random() * width; y = -edgeMargin; break; // Top
        case 1: x = width + edgeMargin; y = Math.random() * height; break; // Right
        case 2: x = Math.random() * width; y = height + edgeMargin; break; // Bottom
        case 3: x = -edgeMargin; y = Math.random() * height; break; // Left
    }

    // Avoid spawning directly on player if requested
    if (awayFromPlayer && player && circleCollision(x, y, 80, player.x, player.y, 150)) {
        // Too close, try spawning on the opposite side roughly
        switch (edge) {
            case 0: y = height + edgeMargin; break; // If top, spawn bottom
            case 1: x = -edgeMargin; break;       // If right, spawn left
            case 2: y = -edgeMargin; break;       // If bottom, spawn top
            case 3: x = width + edgeMargin; break; // If left, spawn right
        }
    }


    // Target direction towards the center area with variation
    const targetX = width * (0.3 + Math.random() * 0.4);
    const targetY = height * (0.3 + Math.random() * 0.4);
    const angle = Math.atan2(targetY - y, targetX - x) + (Math.random() - 0.5) * 0.8; // Add randomness

    // Determine size (higher chance of larger asteroids at higher levels)
    let size = 3; // Start with Tiny
    if (gameLevel >= 6 && Math.random() < 0.15) size = 0; // 15% chance Large (Level 6+)
    else if (gameLevel >= 4 && Math.random() < 0.25) size = 1; // 25% chance Medium (Level 4+)
    else if (gameLevel >= 2 && Math.random() < 0.35) size = 2; // 35% chance Small (Level 2+)
    // Otherwise remains Tiny

    const speedMultiplier = 1 + (gameLevel - 1) * 0.1; // Speed increases with level

    asteroids.push(new Asteroid(x, y, size, angle, speedMultiplier));
}

/** Spawns a powerup at a specific location */
function spawnPowerup(x, y) {
    // Filter available types based on level
    let availableTypes = ["doubleShot", "rapidFire", "shield"];
    if (gameLevel >= 5 && Math.random() < 0.3) { // Field Bomb less common, starts Level 5
        availableTypes.push("fieldBomb");
    }
    const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
    powerups.push(new Powerup(x, y, type));
}

/** Spawns a gravity field */
function spawnGravityField() {
    let x, y, radius, strength;
    const minRadius = 100;
    const maxRadius = 250;
    const baseStrength = 0.8;

    radius = minRadius + Math.random() * (maxRadius - minRadius) + gameLevel * 5;
    strength = (Math.random() > 0.5 ? 1 : -1) * (baseStrength + gameLevel * 0.05); // Positive pull, negative push, stronger with level

    // Try to spawn away from player
    const attempts = 5;
    for (let i = 0; i < attempts; i++) {
        x = Math.random() * width;
        y = Math.random() * height;
        if (!player || !circleCollision(x, y, radius, player.x, player.y, SHIP_SIZE * 3)) {
            break; // Found a suitable spot
        }
        // If last attempt, spawn anyway
    }

    gravityFields.push(new GravityField(x, y, radius, strength));
    // Show notification
    const notifType = strength > 0 ? 'gravityWell' : 'repulsionField';
    showNotification(notifType, x, y - radius - 10); // Position above field
}

/** Spawns a danger zone */
function spawnDangerZone() {
    const minSize = 100;
    const maxSize = 250;
    const zoneWidth = minSize + Math.random() * (maxSize - minSize);
    const zoneHeight = minSize + Math.random() * (maxSize - minSize);
    const x = Math.random() * (width - zoneWidth);
    const y = Math.random() * (height - zoneHeight);

    dangerZones.push(new DangerZone(x, y, zoneWidth, zoneHeight));
    showNotification('dangerZone', x + zoneWidth / 2, y + zoneHeight / 2);
}

/** Spawns a meteor during a meteor shower */
function spawnMeteor() {
    const x = Math.random() * width;
    const y = -50; // Start above screen
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.6; // Mostly downwards
    const speedMultiplier = 1.5 + Math.random() * 0.5; // Faster than normal asteroids
    asteroids.push(new Asteroid(x, y, 3, angle, speedMultiplier, true)); // size 3 = Tiny, isMeteor = true
}

/** Spawns a bonus target during bonus round */
function spawnBonusTarget() {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const pointValues = [100, 200, 300]; // Possible point values
    const points = pointValues[Math.floor(Math.random() * pointValues.length)];
    bonusTargets.push(new BonusTarget(x, y, points));
}


//=============================================================================
// GAME EVENT HANDLING (Level Up, Bonus Rounds, Meteors)
//=============================================================================

function handleGameEvents(deltaTime) {
    // --- Meteor Shower ---
    if (meteorShowerActive) {
        meteorShowerTimer -= deltaTime;
        // Spawn meteors frequently
        const meteorSpawnChancePerSecond = 5 + gameLevel; // More meteors at higher levels
        if (Math.random() < meteorSpawnChancePerSecond * deltaTime) {
            spawnMeteor();
        }
        if (meteorShowerTimer <= 0) {
            endMeteorShower();
        }
    } else {
        // Chance to trigger meteor shower (starts level 3)
        if (gameLevel >= 3 && Math.random() < (0.0005 + (gameLevel - 3) * 0.0002) * (60 * deltaTime)) {
            triggerMeteorShower();
        }
    }

    // --- Bonus Round ---
    if (bonusRoundActive) {
        bonusRoundTimer -= deltaTime;
        if (bonusRoundTimer <= 0) {
            endBonusRound();
        }
        // Spawning handled in handleSpawning
    } else {
        // Chance to trigger bonus round (starts level 4)
        if (!meteorShowerActive && gameLevel >= 4 && Math.random() < (0.0003 + (gameLevel - 4) * 0.0001) * (60 * deltaTime)) {
            triggerBonusRound();
        }
    }
}

function checkLevelProgression() {
    // Check if there is a next level
    if (gameLevel < levelThresholds.length - 1) {
        const nextLevelThreshold = levelThresholds[gameLevel]; // Get the threshold for the NEXT level

        // Check if the score is greater than or equal to the NEXT level's threshold
        if (score >= nextLevelThreshold) {
            gameLevel++;
            scoreMultiplier = 1 + (gameLevel - 1) * 0.4;

            showNotification('levelUp', width / 2, 60, gameLevel, scoreMultiplier);
            playSound('levelup');
            screenShake = 0.6;
        }
    }
}


function checkWeaponUpgrade() {
    const upgradeThresholds = { 2: 8000, 3: 25000 }; // Score thresholds for levels 2 and 3

    if (weaponLevel < 3 && score >= upgradeThresholds[weaponLevel + 1]) {
        weaponLevel++;
        showNotification('weaponUpgrade', width / 2, height / 2, weaponLevel);
        playSound('powerup'); // Reuse powerup sound or make a new one
    }
}

function triggerMeteorShower() {
    if (meteorShowerActive || bonusRoundActive) return; // Don't overlap events

    meteorShowerActive = true;
    meteorShowerDuration = 8 + gameLevel * 1.5; // Duration scales with level
    meteorShowerTimer = meteorShowerDuration;
    showNotification('meteorShowerIncoming', width / 2, height / 2);
    playSound('levelup'); // Use levelup sound as warning? Or new sound?
    screenShake = 0.5;
}

function endMeteorShower() {
    meteorShowerActive = false;
    showNotification('meteorShowerEnded', width / 2, height / 2);
}

function triggerBonusRound() {
    if (bonusRoundActive || meteorShowerActive) return;

    bonusRoundActive = true;
    bonusRoundDuration = 15; // Fixed duration? Or scales?
    bonusRoundTimer = bonusRoundDuration;
    bonusMultiplier = 2 + Math.floor(gameLevel / 2);

    showNotification('bonusRound', width / 2, height / 2, bonusMultiplier);
    playSound('levelup'); // Or specific bonus sound
    screenShake = 0.7;

    // Initial burst of targets
    for (let i = 0; i < 5 + gameLevel; i++) spawnBonusTarget();
}

function endBonusRound() {
    bonusRoundActive = false;
    bonusTargets = []; // Clear remaining targets
    showNotification('bonusRoundEnded', width / 2, height / 2);

    // Spawn some asteroids immediately after bonus ends
    const postBonusAsteroids = 2 + Math.floor(gameLevel / 2);
    for (let i = 0; i < postBonusAsteroids; i++) {
        spawnAsteroid(true); // Spawn away from player
    }
}

//=============================================================================
// VISUAL & AUDIO EFFECTS
//=============================================================================

/** Creates particles and screen shake for various effects */
function createEffect(type, x, y, options = {}) {
    const effect = EFFECTS[type];
    if (!effect) return;

    // Use provided options or defaults from EFFECTS config
    const size = options.size || effect.baseSize;
    const color = options.color || effect.color;
    const speed = options.speed || effect.speed;
    const shake = options.shake || effect.shake;
    const sound = options.sound || effect.sound; // Get sound from config

    // Apply Screen Shake (additive, capped)
    screenShake = Math.min(1.0, screenShake + shake);

    // Create Particles
    const particleCount = Math.min(Math.round(size * 0.8), MAX_PARTICLES - particles.length); // Scale particle count, respect limit
    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const particleSpeed = speed * (0.5 + Math.random()); // Randomize speed
        const particleLife = 0.4 + Math.random() * 0.6; // Randomize lifespan
        let particleColor = color;
        // Add color variation for explosions
        if (type === 'explosion' || type === 'shieldHit') {
            if (Math.random() < 0.3) particleColor = "#FFFFFF"; // White sparks
            else if (Math.random() < 0.2) particleColor = getComplementaryColor(color); // Complementary sparks
        }

        particles.push(new Particle(
            x, y,
            Math.cos(angle) * particleSpeed,
            Math.sin(angle) * particleSpeed,
            Math.random() * 2.5 + 1, // Particle size
            particleColor,
            particleLife
        ));
    }

    // Play Sound
    if (sound) {
        playSound(sound);
    }
}

/** Creates a text notification particle */
function showNotification(type, x, y, ...args) {
    const configGetter = NOTIFICATIONS[type];
    if (!configGetter) return;

    const config = configGetter(...args); // Call the function to get config object
    if (!config) return;

    // Main Text
    particles.push(new TextParticle(x, y, config.main, config.color, config.duration));

    // Sub Text (if exists)
    if (config.sub) {
        particles.push(new TextParticle(x, y + 25, config.sub, config.color, config.duration));
    }
}


/** Specific logic for the Field Bomb powerup explosion */
function createFieldBombExplosion() {
    if (!player) return;

    const radius = 250 + weaponLevel * 25; // Radius increases with weapon level slightly
    const effectX = player.x;
    const effectY = player.y;

    // Create the visual blast radius indicator
    // Create multiple expanding rings
    for (let i = 0; i < 4; i++) {
        particles.push(new BlastRadiusParticle(effectX, effectY, radius, i * 0.15)); // Staggered start times
    }

    // Core explosion visual effect
    createEffect('fieldBomb', effectX, effectY); // Uses EFFECTS config

    // Show notification
    const notifType = 'fieldBombDetonation';
    showNotification(notifType, effectX, effectY - 50); // Position above field

    // Damage asteroids within radius
    let pointsEarned = 0;
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const asteroid = asteroids[i];
        const dx = asteroid.x - effectX;
        const dy = asteroid.y - effectY;
        const distSq = dx * dx + dy * dy;

        if (distSq < (radius + asteroid.radius) * (radius + asteroid.radius)) { // Check distance squared
            pointsEarned += calculateAsteroidScore(asteroid.size);
            createEffect('explosion', asteroid.x, asteroid.y, { size: asteroid.radius }); // Explosion at asteroid location
            asteroids.splice(i, 1); // Remove asteroid
        }
    }
    // Award points (apply multipliers)
    score += Math.floor(pointsEarned * scoreMultiplier * (bonusRoundActive ? bonusMultiplier : 1));

}


//=============================================================================
// AUDIO HANDLING
//=============================================================================

function initializeAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // Resume context on first user interaction (often needed by browsers)
        const resumeAudio = () => {
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            document.removeEventListener('click', resumeAudio);
            document.removeEventListener('touchstart', resumeAudio);
            document.removeEventListener('keydown', resumeAudio);
        };
        document.addEventListener('click', resumeAudio, { once: true });
        document.addEventListener('touchstart', resumeAudio, { once: true });
        document.addEventListener('keydown', resumeAudio, { once: true });

    } catch (e) {
        console.error("Web Audio API is not supported in this browser.");
        soundEnabled = false; // Disable sound if context fails
    }

    // Sound Toggle Button Logic (already exists in HTML, just add listener)
    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            soundToggleBtn.textContent = soundEnabled ? '🔊' : '🔇';
            // If disabling sound, maybe stop any ongoing loops?
        });
    } else {
        console.warn("Sound toggle button not found.");
    }
}

function playSound(type) {
    if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;

    let oscType = 'sine';
    let freq1 = 440, freq2 = 440;
    let gainVal = 0.3;
    let decay = 0.1;
    let volDecayType = 'linear'; // 'linear' or 'exponential'
    let freqDecayType = 'linear';
    let useNoise = false;
    let noiseDuration = 0.1;
    let noiseGain = 0.1;

    // --- Sound Definitions ---
    switch (type) {
        case 'shoot':
            oscType = 'sawtooth'; freq1 = 900; freq2 = 100; gainVal = 0.2; decay = 0.1; freqDecayType = 'exponential'; volDecayType = 'exponential';
            break;
        case 'explosion':
            oscType = 'square'; freq1 = 160; freq2 = 30; gainVal = 0.25; decay = 0.3; freqDecayType = 'exponential'; volDecayType = 'exponential';
            useNoise = true; noiseDuration = 0.25; noiseGain = 0.15;
            break;
        case 'nuke': // Field Bomb
            oscType = 'sine'; freq1 = 120; freq2 = 30; gainVal = 0.6; decay = 1.0; freqDecayType = 'exponential'; volDecayType = 'exponential';
            // Add secondary 'whoosh' or rumble later?
            useNoise = true; noiseDuration = 0.8; noiseGain = 0.2; // Rumble noise
            break;
        case 'powerup':
            oscType = 'triangle'; freq1 = 440; freq2 = 880; gainVal = 0.3; decay = 0.2; volDecayType = 'linear'; freqDecayType = 'linear'; // Ascending pitch
            break;
        case 'gameover':
            oscType = 'sine'; freq1 = 440; freq2 = 110; gainVal = 0.4; decay = 0.8; freqDecayType = 'exponential'; volDecayType = 'exponential'; // Descending pitch
            break;
        case 'highscore':
        case 'levelup': // Use same sound for level up and high score?
            oscType = 'triangle'; freq1 = 523; freq2 = 1046; gainVal = 0.35; decay = 0.4; volDecayType = 'linear'; freqDecayType = 'linear'; // Higher ascending pitch
            // Could add a second oscillator for harmony
            break;
        // Add more sounds: shield_hit, player_hit, bonus_collect, etc.
    }
    // --- Play Sound ---
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioContext.destination);

    osc.type = oscType;
    gainNode.gain.setValueAtTime(gainVal, now);
    osc.frequency.setValueAtTime(freq1, now);

    // Frequency / Volume decay
    if (freqDecayType === 'exponential') {
        osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, freq2), now + decay);
    } else {
        osc.frequency.linearRampToValueAtTime(Math.max(0.01, freq2), now + decay);
    }
    if (volDecayType === 'exponential') {
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + decay * 1.1); // Decay volume slightly longer than freq
    } else {
        gainNode.gain.linearRampToValueAtTime(0.0001, now + decay * 1.1);
    }


    osc.start(now);
    osc.stop(now + decay * 1.1);

    // Optional Noise component
    if (useNoise) {
        // Use timeout to delay noise slightly for explosion effect
        const noiseDelay = (type === 'explosion') ? 0.03 : 0;
        setTimeout(() => {
            if (!soundEnabled || audioContext.state !== 'running') return; // Re-check sound enabled status
            const noise = createNoiseGenerator(audioContext);
            const noiseGainNode = audioContext.createGain();
            noise.connect(noiseGainNode);
            noiseGainNode.connect(audioContext.destination);

            noiseGainNode.gain.setValueAtTime(noiseGain, now + noiseDelay);
            noiseGainNode.gain.exponentialRampToValueAtTime(0.0001, now + noiseDelay + noiseDuration);

            noise.start(now + noiseDelay);
            noise.stop(now + noiseDelay + noiseDuration);
        }, noiseDelay * 1000);
    }
}

// Helper to create noise buffer source
function createNoiseGenerator(actx) {
    const bufferSize = actx.sampleRate * 0.5; // 0.5 seconds of noise buffer
    const noiseBuffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1; // White noise
    }
    const whiteNoise = actx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;
    return whiteNoise;
}


//=============================================================================
// HIGH SCORE MANAGEMENT
//=============================================================================

function loadHighScore() {
    try {
        const savedScore = localStorage.getItem('cosmicAssaultHighScore');
        highScore = parseInt(savedScore, 10) || 0; // Use base 10 and default to 0
    } catch (e) {
        console.warn("Could not load high score:", e);
        highScore = 0;
    }
}

function saveHighScore() {
    try {
        localStorage.setItem('cosmicAssaultHighScore', highScore);
    } catch (e) {
        console.warn("Could not save high score:", e);
    }
}

function checkHighScore() {
    if (score > highScore) {
        const oldHighScore = highScore;
        highScore = score;
        saveHighScore();
        // Only play sound and show notification if it's a *new* high score > 0
        if (highScore > oldHighScore && highScore > 0) {
            createHighScoreCelebration();
        }
        return true; // New high score was set
    }
    return false; // Score was not higher
}

function createHighScoreCelebration() {
    // Visual effect (Burst of colorful particles)
    const celebrationParticles = 50;
    for (let i = 0; i < celebrationParticles; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 100 + Math.random() * 150; // Faster particles
        const life = 1.5 + Math.random();
        const color = `hsl(${Math.random() * 360}, 100%, 60%)`; // Bright random colors
        particles.push(new Particle(
            width / 2, height / 2, // Burst from center
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            Math.random() * 3 + 2,
            color,
            life
        ));
    }
    // Play Sound
    playSound('highscore');
}


//=============================================================================
// MOBILE CONTROLS & ORIENTATION
//=============================================================================

function initializeMobileControls() {
    // Get element references (assuming they are available now)
    mobileControlsEl = document.querySelector('.mobile-controls');
    joystickBaseEl = document.getElementById('joystick-base');
    joystickHandleEl = document.getElementById('joystick-handle');
    fireButtonEl = document.getElementById('fire-button');
    upArrowEl = document.getElementById('up-arrow');
    downArrowEl = document.getElementById('down-arrow');
    leftArrowEl = document.getElementById('left-arrow');
    rightArrowEl = document.getElementById('right-arrow');
    toggleMobileBtn = document.getElementById('toggle-mobile'); // Test button
    restartBtn = document.getElementById('restart-button'); // Added back

    // Check if elements exist before adding listeners
    if (!mobileControlsEl || !joystickBaseEl || !joystickHandleEl || !fireButtonEl || !toggleMobileBtn || !restartBtn) { // Added restartBtn check back
        console.error("One or more mobile control elements not found!");
        return;
    }

    // Determine if mobile controls should be active
    isMobileControlsActive = isMobileDevice() || testMode;
    mobileControlsEl.style.display = isMobileControlsActive ? 'block' : 'none';

    // Show test button only in test mode
    toggleMobileBtn.style.display = testMode ? 'block' : 'none';
    toggleMobileBtn.addEventListener('click', () => {
        isMobileControlsActive = !isMobileControlsActive;
        mobileControlsEl.style.display = isMobileControlsActive ? 'block' : 'none';
        toggleMobileBtn.textContent = isMobileControlsActive ? 'Hide Mobile' : 'Test Mobile';
    });

    // --- Event Listeners ---
    // Use named functions for listeners to allow removal if needed
    const onTouchStart = (e) => handleTouchStart(e);
    const onTouchMove = (e) => handleTouchMove(e);
    const onTouchEnd = (e) => handleTouchEnd(e);

    // Joystick Base
    joystickBaseEl.addEventListener('touchstart', onTouchStart, { passive: false });
    // Add listeners to the document to track movement/end even if finger leaves the base
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onTouchEnd, { passive: false }); // Handle cancellation

    // Fire Button
    fireButtonEl.addEventListener('touchstart', (e) => { e.preventDefault(); keys[' '] = true; }, { passive: false });
    fireButtonEl.addEventListener('touchend', (e) => { e.preventDefault(); keys[' '] = false; }, { passive: false });
    fireButtonEl.addEventListener('touchcancel', (e) => { e.preventDefault(); keys[' '] = false; }, { passive: false });

    // Restart Button (Mobile Only Listener)
    restartBtn.addEventListener('touchstart', (e) => {
        if (isMobileControlsActive && gameState === "gameOver") {
            e.preventDefault();
            startGame();
        }
    }, { passive: false });


    // Desktop mouse equivalents for testing (only if test mode or forced active)
    if (isMobileControlsActive) {
        joystickBaseEl.addEventListener('mousedown', onTouchStart); // Simulate touchstart
        document.addEventListener('mousemove', onTouchMove); // Simulate touchmove
        document.addEventListener('mouseup', onTouchEnd); // Simulate touchend
        fireButtonEl.addEventListener('mousedown', () => keys[' '] = true);
        fireButtonEl.addEventListener('mouseup', () => keys[' '] = false);
    }

    // Canvas touch listener for starting game on title screen
    canvas.addEventListener('touchstart', (e) => {
        if (gameState === "title") {
            e.preventDefault(); // Prevent potential double-tap zoom
            startGame();
        }
    }, { passive: false });
}

// Store the identifier of the touch controlling the joystick
let joystickTouchId = null;

function handleTouchStart(e) {
    if (!isMobileControlsActive) return;

    // Prevent default behavior like scrolling
    e.preventDefault();

    let touch;
    if (e.type === 'mousedown') {
        touch = e; // Use mouse event directly
        joystickTouchId = 'mouse'; // Special ID for mouse
    } else {
        // Find the touch that started on the joystick base
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.target === joystickBaseEl || joystickBaseEl.contains(t.target)) {
                touch = t;
                joystickTouchId = t.identifier;
                break;
            }
        }
    }

    if (!touch) return; // Touch didn't start on the joystick

    joystickActive = true;
    const rect = joystickBaseEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    updateJoystickPosition(touch, centerX, centerY, rect.width / 2);
}

function handleTouchMove(e) {
    if (!isMobileControlsActive || !joystickActive || joystickTouchId === null) return;
    e.preventDefault();

    let touch;
    if (joystickTouchId === 'mouse') {
        touch = e; // Use mouse event directly
    } else {
        // Find the touch associated with the joystick
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) {
                touch = e.changedTouches[i];
                break;
            }
        }
    }

    if (!touch) return; // Relevant touch not found in this move event

    const rect = joystickBaseEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    updateJoystickPosition(touch, centerX, centerY, rect.width / 2);
}

function handleTouchEnd(e) {
    if (!isMobileControlsActive || !joystickActive || joystickTouchId === null) return;

    let touchEnded = false;
    if (joystickTouchId === 'mouse' && e.type === 'mouseup') {
        touchEnded = true;
    } else if (e.changedTouches) {
        // Check if the touch that ended is the one controlling the joystick
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) {
                touchEnded = true;
                break;
            }
        }
    }

    if (touchEnded) {
        joystickActive = false;
        joystickTouchId = null;
        resetJoystickVisuals();
        // Stop thrusting in player update
        if (player) player.thrusting = false;
        if (player) player.currentJoystickDistance = 0;
    }
}


function updateJoystickPosition(touch, centerX, centerY, baseRadius) {
    // Use clientX/Y which are relative to the viewport
    const touchX = touch.clientX;
    const touchY = touch.clientY;

    const deltaX = touchX - centerX;
    const deltaY = touchY - centerY;

    joystickAngle = Math.atan2(deltaY, deltaX);
    joystickDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    const handleRadius = joystickHandleEl.offsetWidth / 2; // Radius of the handle itself
    const maxHandleTravel = baseRadius - handleRadius; // Max distance handle center can move from base center

    const clampedDistance = Math.min(joystickDistance, maxHandleTravel);

    // Calculate handle position relative to the base's center
    const handleX = clampedDistance * Math.cos(joystickAngle);
    const handleY = clampedDistance * Math.sin(joystickAngle);

    // Apply position using transform for potentially smoother rendering
    // Position is relative to the base's center (baseRadius, baseRadius)
    joystickHandleEl.style.transform = `translate(${handleX}px, ${handleY}px)`;

    // Update direction highlights
    updateDirectionHighlights(joystickAngle, joystickDistance > 10); // Use a deadzone
}

function resetJoystickVisuals() {
    // Reset handle position to center using transform
    joystickHandleEl.style.transform = 'translate(0px, 0px)';
    // Reset highlights
    updateDirectionHighlights(0, false);
}


function updateDirectionHighlights(angle, isActive) {
    const highlightColor = 'rgba(57, 255, 20, 1)'; // Bright green
    const highlightShadow = '0 0 10px rgba(57, 255, 20, 0.8)';
    const defaultColor = 'rgba(57, 255, 20, 0.8)';
    const defaultShadow = 'none';

    // Reset all first
    [upArrowEl, downArrowEl, leftArrowEl, rightArrowEl].forEach(el => {
        if (el) {
            el.style.color = defaultColor;
            el.style.textShadow = defaultShadow;
        }
    });

    if (!isActive) return; // No highlights if joystick is centered

    // Determine active zone (degrees, 0 is right)
    const angleDeg = (angle * 180 / Math.PI + 360) % 360;
    let activeArrow = null;

    if (angleDeg >= 45 && angleDeg < 135) activeArrow = upArrowEl;      // Up (45 to 135)
    else if (angleDeg >= 135 && angleDeg < 225) activeArrow = leftArrowEl;  // Left (135 to 225)
    else if (angleDeg >= 225 && angleDeg < 315) activeArrow = downArrowEl; // Down (225 to 315)
    else activeArrow = rightArrowEl; // Right (315 to 45)

    if (activeArrow) {
        activeArrow.style.color = highlightColor;
        activeArrow.style.textShadow = highlightShadow;
    }
}


function checkOrientation() {
    const isCurrentlyMobile = isMobileDevice(); // Check current state

    // Get elements safely
    orientationMessageEl = orientationMessageEl || document.getElementById('orientation-message');
    fullscreenPromptEl = fullscreenPromptEl || document.getElementById('fullscreen-prompt');
    iosModalEl = iosModalEl || document.getElementById('ios-homescreen-modal');
    const canvasEl = canvas; // Already assigned
    const mobileControlsContainer = mobileControlsEl; // Already assigned

    if (!orientationMessageEl || !canvasEl) {
        return; // Don't proceed if essential elements aren't found
    }

    if (isCurrentlyMobile) {
        const isPortrait = window.innerHeight > window.innerWidth;

        orientationMessageEl.style.display = isPortrait ? 'flex' : 'none';
        canvasEl.style.display = isPortrait ? 'none' : 'block';
        if (mobileControlsContainer) {
            mobileControlsContainer.style.display = (isPortrait || !isMobileControlsActive) ? 'none' : 'block';
        }

        if (isPortrait) {
            // If switching to portrait while playing, pause the game
            if (gameState === "playing") {
                previousGameState = gameState;
                gameState = "paused";
                // Maybe show a paused message on canvas if possible?
            }
            // Hide modals if orientation message is shown
            if (fullscreenPromptEl) fullscreenPromptEl.style.display = 'none';
            if (iosModalEl) iosModalEl.style.display = 'none';

        } else {
            // Switching to landscape
            // Resume game if it was paused due to orientation
            if (gameState === "paused" && previousGameState === "playing") {
                gameState = previousGameState;
                previousGameState = null;
                lastTime = performance.now(); // Reset lastTime to avoid large deltaTime jump
            }

            // Handle Fullscreen prompt / iOS PWA suggestion
            handleFullscreenAndPWA();

        }
    } else {
        // On desktop, ensure orientation message is hidden and canvas is visible
        orientationMessageEl.style.display = 'none';
        canvasEl.style.display = 'block';
        if (mobileControlsContainer) {
            mobileControlsContainer.style.display = isMobileControlsActive ? 'block' : 'none';
        }
        // Ensure game isn't stuck in paused state from orientation
        if (gameState === "paused" && previousGameState === "playing") {
            gameState = previousGameState;
            previousGameState = null;
            lastTime = performance.now();
        }
    }
}

//=============================================================================
// FULLSCREEN & PWA HANDLING
//=============================================================================

function handleFullscreenAndPWA() {
    // Ensure elements are available
    if (!fullscreenPromptEl || !iosModalEl) return;

    // --- iOS PWA Suggestion ---
    // Check if on iOS, not already a PWA, and modal hasn't been closed this session
    const isStandalone = window.navigator.standalone === true;
    if (isIOSDevice() && !isStandalone && iosModalEl.style.display !== 'none') {
        // Show the iOS PWA modal ONCE per session or until added.
        // We might need a flag to track if it was closed. Let's assume
        // we only show it if its display is currently 'none'.
        // This logic might need refinement based on desired UX.
        // Currently, it shows if landscape, iOS, not standalone.
        iosModalEl.style.display = 'flex';
        // Hide fullscreen prompt if PWA modal is shown
        fullscreenPromptEl.style.display = 'none';
        return; // Don't show fullscreen prompt if PWA modal is up
    }

    // --- Fullscreen Prompt ---
    // Check preference only if not iOS PWA modal shown
    if (fullscreenPreference === 'ask' && !hasSeenFullscreenPrompt && !document.fullscreenElement) {
        fullscreenPromptEl.style.display = 'flex';
        hasSeenFullscreenPrompt = true; // Mark as seen for this session
    } else if (fullscreenPreference === 'yes' && !document.fullscreenElement) {
        // Automatically try to enter fullscreen if preferred
        enterFullscreen();
    }
}


function enterFullscreen() {
    const element = document.documentElement; // Fullscreen the whole page
    const requestMethod = element.requestFullscreen || element.webkitRequestFullscreen || element.mozRequestFullScreen || element.msRequestFullscreen;

    if (requestMethod) {
        requestMethod.call(element).then(() => {
            if (exitFullscreenBtn) exitFullscreenBtn.style.display = 'block';
        }).catch(err => {
            console.warn(`Fullscreen request failed: ${err.message}`);
            // Maybe show a brief text particle message on failure for non-iOS
            if (!isIOSDevice() && gameState === 'playing') {
                showNotification('fullscreenError', width / 2, height / 2); // Define this notification type
            }
        });
    } else if (isIOSDevice()) {
        // On iOS, fullscreen API is limited, guide user to Add to Home Screen
        if (iosModalEl) iosModalEl.style.display = 'flex';
    }
}

function exitFullscreen() {
    const exitMethod = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exitMethod) {
        exitMethod.call(document).catch(err => {
            console.warn(`Exit fullscreen failed: ${err.message}`);
        });
    }
}

function handleFullscreenChange() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.mozFullScreenElement && !document.msFullscreenElement) {
        // Exited fullscreen mode
        if (exitFullscreenBtn) exitFullscreenBtn.style.display = 'none';
    } else {
        // Entered fullscreen mode (redundant check as button is shown on success, but safe)
        if (exitFullscreenBtn) exitFullscreenBtn.style.display = 'block';
    }
}

function rememberFullscreenPreference(preference) {
    fullscreenPreference = preference;
    try {
        localStorage.setItem('cosmicAssaultFullscreenPreference', preference);
    } catch (e) {
        console.warn("Could not save fullscreen preference:", e);
    }
}


//=============================================================================
// INITIALIZATION
//=============================================================================

/** Main initialization function called on window load */
window.onload = function () {
    // Get Canvas and Context
    canvas = document.getElementById("gameCanvas");
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }
    ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error("Failed to get 2D context!");
        return;
    }

    // Get other DOM element references
    orientationMessageEl = document.getElementById('orientation-message');
    fullscreenPromptEl = document.getElementById('fullscreen-prompt');
    iosModalEl = document.getElementById('ios-homescreen-modal');
    exitFullscreenBtn = document.getElementById('exit-fullscreen');
    soundToggleBtn = document.getElementById('sound-toggle');
    fullscreenToggleBtn = document.getElementById('fullscreen-toggle');
    // Mobile control elements are fetched in initializeMobileControls

    // Load Settings
    loadHighScore();
    fullscreenPreference = localStorage.getItem('cosmicAssaultFullscreenPreference') || 'ask';


    // Initial Resize & Star Creation
    resizeCanvas(); // Sets initial width/height and creates stars

    // Initialize Sub-systems
    initializeAudio();
    initializeMobileControls(); // Sets up listeners based on device/testMode

    // Setup Event Listeners
    window.addEventListener('resize', () => { resizeCanvas(); checkOrientation(); }); // Resize canvas and check orientation
    window.addEventListener('orientationchange', checkOrientation); // Check orientation on change

    // Keyboard Listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Fullscreen API Listeners
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Fullscreen Prompt Button Listeners
    const enterFsBtn = document.getElementById('enter-fullscreen');
    const skipFsBtn = document.getElementById('skip-fullscreen');
    if (enterFsBtn) enterFsBtn.addEventListener('click', () => {
        rememberFullscreenPreference('yes');
        enterFullscreen();
        if (fullscreenPromptEl) fullscreenPromptEl.style.display = 'none';
    });
    if (skipFsBtn) skipFsBtn.addEventListener('click', () => {
        rememberFullscreenPreference('no');
        if (fullscreenPromptEl) fullscreenPromptEl.style.display = 'none';
    });

    // iOS Modal Close Button
    const closeIosBtn = document.getElementById('close-ios-modal');
    if (closeIosBtn) closeIosBtn.addEventListener('click', () => {
        if (iosModalEl) iosModalEl.style.display = 'none';
    });


    // Exit Fullscreen Button Listener (Top Right X)
    if (exitFullscreenBtn) exitFullscreenBtn.addEventListener('click', exitFullscreen);

    // Fullscreen Toggle Button Listener (Persistent Button)
    if (fullscreenToggleBtn) fullscreenToggleBtn.addEventListener('click', () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            enterFullscreen();
        } else {
            exitFullscreen();
        }
    });

    // Initial Orientation Check
    checkOrientation(); // Run check after setup

    // Start Game Loop
    lastTime = performance.now(); // Initialize lastTime
    requestAnimationFrame(gameLoop);
};

/** Handles canvas resizing and star regeneration */
function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    createStars(); // Recreate stars for new dimensions
}

/** Creates the background starfield */
function createStars() {
    stars = [];
    const starCount = Math.min(200, Math.floor(width * height / 5000)); // Scale star count roughly with area
    for (let i = 0; i < starCount; i++) {
        stars.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 1.5 + 0.2, // Slightly larger minimum size
            color: Math.random() > 0.95 ? "#FF00FF" : (Math.random() > 0.9 ? "#00FFFF" : "#FFFFFF") // Add cyan stars
        });
    }
}

/** Handles key down events */
function handleKeyDown(e) {
    // Use e.key for modern browsers, fall back to keyCode if needed, but prefer key
    const key = e.key.toUpperCase(); // Normalize to uppercase

    // Start game on title screen (ignore modifier keys, F5, etc.)
    if (gameState === "title" && !e.metaKey && !e.ctrlKey && !e.altKey && key !== 'F5' && key !== 'F12') {
        // Check if audio context needs resuming (first interaction)
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        startGame();
    }

    // Restart game on game over screen
    if (gameState === "gameOver" && key === "R") {
        startGame();
        // Prevent 'R' key state from being set true after restart
        return;
    }

    // Set key state for movement/shooting (only if playing)
    if (gameState === "playing") {
        keys[e.key] = true; // Use original e.key for consistency (e.g. "ArrowLeft")
        keys[key] = true; // Also store uppercase for easier checking sometimes

        // Prevent spacebar scrolling page
        if (e.key === ' ') {
            e.preventDefault();
        }
    }
}

/** Handles key up events */
function handleKeyUp(e) {
    // Clear both original and uppercase key states
    keys[e.key] = false;
    keys[e.key.toUpperCase()] = false;
}
