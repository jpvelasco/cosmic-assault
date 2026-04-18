export class EventCoordinator {
    constructor(state, effects, audio, spawning) {
        this.state = state;
        this.effects = effects;
        this.audio = audio;
        this.spawning = spawning;
    }

    update(deltaTime) {
        const { state } = this;

        if (state.meteorShowerActive) {
            const spawnChance = (5 + state.gameLevel) * deltaTime;
            if (Math.random() < spawnChance) {
                state.asteroids.push(this.spawning.spawnMeteor(state.width));
            }
        } else if (state.gameLevel >= 3) {
            const triggerChance = (0.0005 + (state.gameLevel - 3) * 0.0002) * (60 * deltaTime);
            if (Math.random() < triggerChance && !state.bonusRoundActive) {
                this._triggerMeteorShower();
            }
        }

        if (!state.bonusRoundActive && !state.meteorShowerActive && state.gameLevel >= 4) {
            const triggerChance = (0.0003 + (state.gameLevel - 4) * 0.0001) * (60 * deltaTime);
            if (Math.random() < triggerChance) {
                this._triggerBonusRound();
            }
        }

        const ended = state.updateEventTimers(deltaTime);
        if (ended.meteorShower) {
            this.effects.showNotification('meteorShowerEnded', state.width / 2, state.height / 2, state.particles);
        }
        if (ended.bonusRound) {
            this.effects.showNotification('bonusRoundEnded', state.width / 2, state.height / 2, state.particles);
            const postBonusCount = 2 + Math.floor(state.gameLevel / 2);
            for (let i = 0; i < postBonusCount; i++) {
                state.asteroids.push(this.spawning.spawnAsteroid(state.gameLevel, state.player, state.width, state.height, true));
            }
        }
    }

    handleSpawnNotifications(spawnEvents) {
        if (spawnEvents.gravityField) {
            const field = spawnEvents.gravityField;
            const notificationType = field.strength > 0 ? 'gravityWell' : 'repulsionField';
            this.effects.showNotification(notificationType, field.x, field.y, this.state.particles);
        }
    }

    _triggerMeteorShower() {
        const duration = 8 + this.state.gameLevel * 1.5;
        this.state.startMeteorShower(duration);
        this.effects.showNotification('meteorShowerIncoming', this.state.width / 2, this.state.height / 2, this.state.particles);
        this.audio.play('levelup');
        this.effects.addScreenShake(0.5);
    }

    _triggerBonusRound() {
        const multiplier = 2 + Math.floor(this.state.gameLevel / 2);
        this.state.startBonusRound(15, multiplier);
        this.effects.showNotification('bonusRound', this.state.width / 2, this.state.height / 2, this.state.particles, multiplier);
        this.audio.play('levelup');
        this.effects.addScreenShake(0.7);

        for (let i = 0; i < 5 + this.state.gameLevel; i++) {
            this.state.bonusTargets.push(this.spawning.spawnBonusTarget(this.state.width, this.state.height));
        }
    }
}
