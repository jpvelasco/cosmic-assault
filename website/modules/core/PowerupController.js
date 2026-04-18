import { POWERUP_CONFIG, POWERUP_TYPE, ASTEROID_SCORES } from './constants.js';

const POWERUP_ACTIVATE = {
    [POWERUP_TYPE.DOUBLE_SHOT]: (player) => player.setWeaponCountMultiplier(2),
    [POWERUP_TYPE.RAPID_FIRE]:  (player) => player.setFireRateMultiplier(2),
    [POWERUP_TYPE.SHIELD]:      (player) => player.activateShield(),
};

const POWERUP_DEACTIVATE = {
    [POWERUP_TYPE.DOUBLE_SHOT]: (player) => player.setWeaponCountMultiplier(1),
    [POWERUP_TYPE.RAPID_FIRE]:  (player) => player.setFireRateMultiplier(1),
    [POWERUP_TYPE.SHIELD]:      (player) => player.deactivateShield(),
};

export class PowerupController {
    constructor(state, effects, audio) {
        this.state = state;
        this.effects = effects;
        this.audio = audio;
    }

    activate(type) {
        const config = POWERUP_CONFIG[type];
        if (!config) return;

        this.audio.play('powerup');
        this.effects.showNotification('powerupCollected', this.state.player.x, this.state.player.y - 30, this.state.particles, type);

        if (type === POWERUP_TYPE.FIELD_BOMB) {
            this._fieldBombExplosion();
            return;
        }

        this.state.activatePowerup(type, config.duration);
        POWERUP_ACTIVATE[type]?.(this.state.player);
        this.effects.createEffect('powerup', this.state.player.x, this.state.player.y, this.state.particles, { color: config.color });
    }

    update(deltaTime) {
        const expired = this.state.updatePowerupTimers(deltaTime);
        expired.forEach(type => POWERUP_DEACTIVATE[type]?.(this.state.player));
    }

    _fieldBombExplosion() {
        const { player } = this.state;
        if (!player) return;

        const radius = 250 + this.state.weaponLevel * 25;
        this.effects.createFieldBombExplosion(player.x, player.y, radius, this.state.particles);
        this.effects.showNotification('fieldBombDetonation', player.x, player.y - 50, this.state.particles);
        this.audio.play('nuke');

        let pointsEarned = 0;
        for (let i = this.state.asteroids.length - 1; i >= 0; i--) {
            const asteroid = this.state.asteroids[i];
            const dx = asteroid.x - player.x;
            const dy = asteroid.y - player.y;
            if (dx * dx + dy * dy < (radius + asteroid.radius) ** 2) {
                pointsEarned += ASTEROID_SCORES[asteroid.size] || 10;
                this.effects.createEffect('explosion', asteroid.x, asteroid.y, this.state.particles, { size: asteroid.radius });
                this.state.asteroids.splice(i, 1);
            }
        }

        this.state.addScore(pointsEarned);
    }
}
