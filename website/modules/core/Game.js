import { GameState } from './GameState.js';
import { GAME_STATES, TEST_MODE } from './constants.js';
import { Renderer } from './Renderer.js';
import { MobileUI } from './MobileUI.js';
import { CollisionHandler } from './CollisionHandler.js';
import { WeaponSystem } from './WeaponSystem.js';
import { PowerupController } from './PowerupController.js';
import { EventCoordinator } from './EventCoordinator.js';
import { exposeTestAPI } from './TestAPI.js';

import { Player } from '../entities/Player.js';
import { Asteroid } from '../entities/Asteroid.js';
import { Particle } from '../entities/Particle.js';

import { CollisionSystem } from '../systems/CollisionSystem.js';
import { SpawningSystem } from '../systems/SpawningSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { InputSystem } from '../systems/InputSystem.js';
import { EffectsSystem } from '../systems/EffectsSystem.js';


function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.state = new GameState();
        this.lastTime = 0;
        this.isMobile = isMobileDevice() || TEST_MODE;

        // Systems
        this.audio = new AudioSystem();
        this.input = new InputSystem();
        this.effects = new EffectsSystem();
        this.spawning = new SpawningSystem();

        // Collaborators
        this.powerupController = new PowerupController(this.state, this.effects, this.audio);
        this.weapons = new WeaponSystem(this.state, this.audio);
        this.events = new EventCoordinator(this.state, this.effects, this.audio, this.spawning);
        this.renderer = new Renderer(this.ctx, this.state, this.effects, this.isMobile);

        this.collision = new CollisionSystem({
            onPlayerHitAsteroid:      (p, a, i)       => this.collisionHandler.handlePlayerAsteroid(p, a, i),
            onPlayerHitDangerZone:    (p, z, i)       => this.collisionHandler.handlePlayerDangerZone(p, z, i),
            onPlayerCollectPowerup:   (pu, i)         => this.collisionHandler.handlePowerupCollect(pu, i),
            onProjectileHitAsteroid:  (pr, pi, a, ai) => this.collisionHandler.handleProjectileAsteroid(pr, pi, a, ai),
            onProjectileHitBonusTarget: (pr, pi, t, ti) => this.collisionHandler.handleProjectileBonusTarget(pr, pi, t, ti)
        });

        // CollisionHandler needs powerupController, so built after it
        this.collisionHandler = new CollisionHandler(
            this.state, this.effects, this.audio, this.spawning,
            this.powerupController,
            () => { if (this.mobileUI) this.mobileUI.showRestartButton(); }
        );
    }

    initialize() {
        this.state.loadHighScore();

        this._resizeCanvas();
        this._createStars();

        this.audio.initialize();
        this.input.initialize({
            isMobile: this.isMobile,
            testMode: TEST_MODE,
            canvas: this.canvas,
            onStartGame: () => this._handleStartInput(),
            onRestartGame: () => this._handleRestartInput()
        });

        if (this.isMobile) {
            this.mobileUI = new MobileUI(this.canvas, this.state);
            this.mobileUI.attach();
        } else {
            window.addEventListener('resize', () => this._resizeCanvas());
        }

        exposeTestAPI(this);
    }

    start() {
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._gameLoop(t));
    }

    _gameLoop(timestamp) {
        const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1);
        this.lastTime = timestamp;

        if (this.state.gameState !== GAME_STATES.PAUSED) {
            this._update(deltaTime);
        }
        this.renderer.render();

        requestAnimationFrame((t) => this._gameLoop(t));
    }

    _update(deltaTime) {
        if (this.state.gameState !== GAME_STATES.PLAYING) return;

        const inputState = this.input.getState();
        this.state.player.update(
            deltaTime,
            inputState,
            this.state.width,
            this.state.height,
            (data) => this.weapons.fire(data),
            (x, y, vx, vy, size, color, life) => this._createParticle(x, y, vx, vy, size, color, life)
        );

        this.state.updateScoreDisplay(deltaTime);
        this._updateEntities(deltaTime);
        this._applyGravityFields(deltaTime);
        this.collision.checkAll(this.state);
        this.powerupController.update(deltaTime);

        const spawnEvents = this.spawning.update(deltaTime, {
            gameLevel: this.state.gameLevel,
            bonusRoundActive: this.state.bonusRoundActive,
            player: this.state.player,
            asteroids: this.state.asteroids,
            gravityFields: this.state.gravityFields,
            dangerZones: this.state.dangerZones,
            bonusTargets: this.state.bonusTargets,
            width: this.state.width,
            height: this.state.height
        });

        this.events.handleSpawnNotifications(spawnEvents);
        this.events.update(deltaTime);
        this._checkProgression();
        this.effects.update(deltaTime);
    }

    _updateEntities(deltaTime) {
        const { width, height } = this.state;
        const createParticle = (x, y, vx, vy, size, color, life) => this._createParticle(x, y, vx, vy, size, color, life);

        const simple  = [this.state.projectiles, this.state.particles];
        const bounded = [this.state.powerups, this.state.gravityFields, this.state.dangerZones, this.state.bonusTargets];

        for (const arr of simple) {
            for (let i = arr.length - 1; i >= 0; i--) {
                arr[i].update(deltaTime);
                if (this._isExpired(arr[i])) arr.splice(i, 1);
            }
        }

        for (const arr of bounded) {
            for (let i = arr.length - 1; i >= 0; i--) {
                arr[i].update(deltaTime, width, height);
                if (this._isExpired(arr[i])) arr.splice(i, 1);
            }
        }

        for (let i = this.state.asteroids.length - 1; i >= 0; i--) {
            this.state.asteroids[i].update(deltaTime, width, height, createParticle);
            if (this._isExpired(this.state.asteroids[i])) this.state.asteroids.splice(i, 1);
        }
    }

    _isExpired(entity) {
        return (entity.lifespan !== undefined && entity.lifespan <= 0) ||
               (entity.active !== undefined && !entity.active);
    }

    _applyGravityFields(deltaTime) {
        this.state.gravityFields.forEach(field => {
            if (this.state.player && this.state.player.alive) {
                const effect = field.applyGravity(this.state.player, deltaTime);
                if (effect && Math.random() < 0.3) {
                    this._createGravityParticle(effect, this.state.player);
                }
            }
            this.state.projectiles.forEach(p => field.applyGravity(p, deltaTime));
            this.state.asteroids.forEach(a => field.applyGravity(a, deltaTime));
        });
    }

    _createGravityParticle(effect, player) {
        const color = effect.isPull ? '#FF00FF' : '#00FFFF';
        const dirMul = effect.isPull ? 1 : -1;
        const offsetX = (Math.random() - 0.5) * 20;
        const offsetY = (Math.random() - 0.5) * 20;
        this.state.particles.push(new Particle(
            player.x + offsetX,
            player.y + offsetY,
            effect.dirX * 150 * dirMul,
            effect.dirY * 150 * dirMul,
            2 + Math.random() * 2,
            color,
            0.4 + Math.random() * 0.3
        ));
    }

    _checkProgression() {
        if (this.state.checkLevelProgression()) {
            this.effects.showNotification('levelUp', this.state.width / 2, 60, this.state.particles, this.state.gameLevel, this.state.scoreMultiplier);
            this.audio.play('levelup');
            this.effects.addScreenShake(0.6);
        }

        const newWeaponLevel = this.state.checkWeaponUpgrade();
        if (newWeaponLevel) {
            this.effects.showNotification('weaponUpgrade', this.state.width / 2, this.state.height / 2, this.state.particles, newWeaponLevel);
            this.audio.play('powerup');
        }
    }

    _startGame() {
        this.state.reset();
        this.state.gameState = GAME_STATES.PLAYING;
        this.state.setDimensions(this.canvas.width, this.canvas.height);
        this.state.loadHighScore();

        this.state.player = new Player(this.state.width / 2, this.state.height / 2);

        for (let i = 0; i < 3; i++) {
            this.state.asteroids.push(
                this.spawning.spawnAsteroid(1, this.state.player, this.state.width, this.state.height, true)
            );
        }

        this.spawning.reset();
        this.effects.reset();
        this.input.reset();

        if (this.state.stars.length === 0) this._createStars();
        if (this.mobileUI) this.mobileUI.hideRestartButton();
    }

    _handleStartInput() {
        if (this.state.gameState === GAME_STATES.TITLE) {
            this.audio.resume();
            this._startGame();
        }
    }

    _handleRestartInput() {
        if (this.state.gameState === GAME_STATES.GAME_OVER) {
            this._startGame();
        }
    }

    _resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.state.setDimensions(this.canvas.width, this.canvas.height);
        this._createStars();
    }

    _createStars() {
        const { width, height } = this.state;
        this.state.stars = [];
        const count = Math.min(200, Math.floor(width * height / 5000));
        for (let i = 0; i < count; i++) {
            this.state.stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: Math.random() * 1.5 + 0.2,
                color: Math.random() > 0.95 ? '#FF00FF' : (Math.random() > 0.9 ? '#00FFFF' : '#FFFFFF')
            });
        }
    }

    _createParticle(x, y, vx, vy, size, color, life) {
        this.state.particles.push(new Particle(x, y, vx, vy, size, color, life));
    }
}
