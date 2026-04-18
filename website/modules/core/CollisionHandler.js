import { ASTEROID_SCORES, SHIP_COLOR, GAME_STATES } from './constants.js';
import { Asteroid } from '../entities/Asteroid.js';

export class CollisionHandler {
    constructor(state, effects, audio, spawning, powerupController, onGameOver) {
        this.state = state;
        this.effects = effects;
        this.audio = audio;
        this.spawning = spawning;
        this.powerupController = powerupController;
        this.onGameOver = onGameOver;
    }

    handlePlayerAsteroid(player, asteroid, index) {
        if (player.shielded) {
            player.shielded = false;
            this.state.activePowerups.shield = false;
            this.state.powerupTimers.shield = 0;
            const sound = this.effects.createEffect('shieldHit', player.x, player.y, this.state.particles, { size: asteroid.radius });
            if (sound) this.audio.play(sound);
        } else {
            this._playerHit();
            this.effects.createEffect('explosion', player.x, player.y, this.state.particles, { size: 30, color: SHIP_COLOR });
        }
        this._breakAsteroid(index);
    }

    handlePlayerDangerZone(player) {
        this._playerHit();
        this.effects.showNotification('dangerZone', player.x, player.y - 30, this.state.particles);
        this.effects.createEffect('explosion', player.x, player.y, this.state.particles, { size: 15, color: '#FF0000', shake: 0.1 });
    }

    handlePowerupCollect(powerup, index) {
        this.powerupController.activate(powerup.type);
        this.state.powerups.splice(index, 1);
    }

    handleProjectileAsteroid(proj, projIndex, asteroid, astIndex) {
        const points = ASTEROID_SCORES[asteroid.size] || 10;
        this.state.addScore(points);
        const sound = this.effects.createEffect('explosion', asteroid.x, asteroid.y, this.state.particles, { size: asteroid.radius });
        if (sound) this.audio.play(sound);
        this.state.projectiles.splice(projIndex, 1);
        this._breakAsteroid(astIndex);
    }

    handleProjectileBonusTarget(proj, projIndex, target, targetIndex) {
        // score added directly (not via addScore) — bonusMultiplier is already factored in here
        // rather than double-applying the multiplier inside addScore
        const points = target.points * this.state.bonusMultiplier;
        this.state.score += points;
        this.effects.showNotification('bonusPoints', target.x, target.y - 20, this.state.particles, points);
        this.effects.createEffect('powerup', target.x, target.y, this.state.particles);
        this.state.projectiles.splice(projIndex, 1);
        this.state.bonusTargets.splice(targetIndex, 1);
    }

    _playerHit() {
        const { state } = this;
        if (state.player.invulnerable) return;

        this.effects.addScreenShake(0.8);
        this.effects.triggerHitFlash(0.6, '#FF0000');
        const isGameOver = state.loseLife();

        if (isGameOver) {
            state.player.alive = false;
            state.gameState = GAME_STATES.GAME_OVER;
            const isNewHighScore = state.checkHighScore();
            state.saveHighScore();
            this.audio.play(isNewHighScore && state.score > 0 ? 'highscore' : 'gameover');
            this.onGameOver();
        } else {
            state.player.respawn(state.width, state.height);
            this.audio.play('explosion');
        }
    }

    _breakAsteroid(index) {
        const asteroid = this.state.asteroids[index];
        if (!asteroid) return;

        if (asteroid.canBreak()) {
            const childSize = asteroid.getChildSize();
            for (let i = 0; i < 2; i++) {
                const angleOffset = (Math.random() - 0.5) * 1.5;
                const speedBoost = 1 + Math.random() * 0.3;
                this.state.asteroids.push(new Asteroid(
                    asteroid.x, asteroid.y,
                    childSize,
                    asteroid.rotation + angleOffset,
                    speedBoost,
                    asteroid.isMeteor
                ));
            }
        }

        const powerup = this.spawning.spawnPowerup(asteroid.x, asteroid.y, this.state.gameLevel);
        if (powerup) this.state.powerups.push(powerup);

        this.state.asteroids.splice(index, 1);
    }
}
