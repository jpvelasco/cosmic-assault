import {
    SHIP_COLOR,
    TEXT_COLOR,
    DEFAULT_FONT,
    POWERUP_TYPES,
    POWERUP_CONFIG,
    GAME_STATES
} from './constants.js';
import { hexToRgb } from '../utils/color.js';

export class Renderer {
    constructor(ctx, state, effects, isMobile) {
        this.ctx = ctx;
        this.state = state;
        this.effects = effects;
        this.isMobile = isMobile;
    }

    render() {
        const { ctx, state } = this;
        const { width, height } = state;

        ctx.clearRect(0, 0, width, height);

        const shake = this.effects.getScreenShake();
        if (shake > 0 && state.gameState === GAME_STATES.PLAYING) {
            ctx.save();
            ctx.translate(
                (Math.random() - 0.5) * shake * 15,
                (Math.random() - 0.5) * shake * 15
            );
        }

        this._drawStars();

        if (state.gameState === GAME_STATES.TITLE) {
            this._drawTitleScreen();
        } else if (state.gameState === GAME_STATES.PLAYING) {
            this._drawGameplay();
            this._drawHUD();
        } else if (state.gameState === GAME_STATES.GAME_OVER) {
            this._drawGameOverScreen();
        }

        if (shake > 0 && state.gameState === GAME_STATES.PLAYING) {
            ctx.restore();
        }

        this.effects.drawHitFlash(ctx, width, height);
    }

    _drawStars() {
        const { ctx, state } = this;
        state.stars.forEach(star => {
            ctx.fillStyle = star.color;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    _drawGameplay() {
        const { ctx, state } = this;
        state.dangerZones.forEach(z => z.draw(ctx));
        state.gravityFields.forEach(f => f.draw(ctx));
        state.asteroids.forEach(a => a.draw(ctx));
        state.powerups.forEach(p => p.draw(ctx));
        state.bonusTargets.forEach(t => t.draw(ctx));
        if (state.player && state.player.alive) state.player.draw(ctx);
        state.projectiles.forEach(p => p.draw(ctx));
        state.particles.forEach(p => p.draw(ctx));
    }

    _drawHUD() {
        const { ctx, state } = this;
        const { width, height } = state;

        ctx.save();
        ctx.font = `20px ${DEFAULT_FONT}`;
        ctx.textBaseline = 'top';

        ctx.textAlign = 'left';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(`SCORE: ${Math.floor(state.scoreDisplay)}`, 20, 60);
        ctx.fillStyle = '#FFFF00';
        ctx.fillText(`HIGH: ${state.highScore}`, 20, 85);

        ctx.textAlign = 'center';
        ctx.fillStyle = TEXT_COLOR;
        ctx.fillText(`LEVEL ${state.gameLevel}`, width / 2, 20);
        ctx.fillStyle = '#FF00FF';
        ctx.fillText(`MULT: ${state.scoreMultiplier.toFixed(1)}x`, width / 2, 45);

        ctx.textAlign = 'right';
        if (state.lives === 1) {
            const pulse = 0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 200));
            ctx.fillStyle = `rgba(255, 0, 0, ${pulse})`;
        } else {
            ctx.fillStyle = '#FFFFFF';
        }
        ctx.fillText(`LIVES: ${state.lives}`, width - 20, 85);
        this._drawLifeIcons(width - 20, 65, state.lives);
        this._drawActivePowerups(width / 2, height - 30);

        if (state.bonusRoundActive) {
            ctx.font = `bold 20px ${DEFAULT_FONT}`;
            ctx.fillStyle = '#FFFF00';
            ctx.shadowColor = '#FFFF00';
            ctx.shadowBlur = 10;
            ctx.textAlign = 'center';
            ctx.fillText(`BONUS: ${Math.ceil(state.bonusRoundTimer)}s`, width / 2, 70);
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    }

    _drawLifeIcons(x, y, count) {
        const { ctx } = this;
        ctx.strokeStyle = SHIP_COLOR;
        ctx.lineWidth = 1.5;
        const size = 10;
        const spacing = size * 1.8;

        ctx.save();
        ctx.translate(x, y);
        for (let i = 0; i < count; i++) {
            ctx.beginPath();
            ctx.moveTo(size * 0.8, 0);
            ctx.lineTo(-size * 0.5, -size * 0.5);
            ctx.lineTo(-size * 0.3, 0);
            ctx.lineTo(-size * 0.5, size * 0.5);
            ctx.closePath();
            ctx.stroke();
            ctx.translate(-spacing, 0);
        }
        ctx.restore();
    }

    _drawActivePowerups(x, y) {
        const { ctx, state } = this;
        ctx.textAlign = 'center';
        ctx.font = `16px ${DEFAULT_FONT}`;
        let count = 0;

        POWERUP_TYPES.forEach(type => {
            if (state.activePowerups[type] && state.powerupTimers[type] > 0) {
                const config = POWERUP_CONFIG[type];
                if (!config || config.duration <= 0) return;

                const remainingTime = Math.ceil(state.powerupTimers[type]);
                const text = type.replace(/([A-Z])/g, ' $1').toUpperCase();

                if (remainingTime <= 3) {
                    const pulse = 0.7 + 0.3 * Math.abs(Math.sin(Date.now() / 150));
                    ctx.fillStyle = `rgba(${hexToRgb(config.color)}, ${pulse})`;
                } else {
                    ctx.fillStyle = config.color;
                }

                ctx.fillText(`${text}: ${remainingTime}s`, x, y - count * 20);
                count++;
            }
        });
    }

    _drawTitleScreen() {
        const { ctx, state } = this;
        const { width, height } = state;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = TEXT_COLOR;

        ctx.font = `bold 60px ${DEFAULT_FONT}`;
        ctx.shadowColor = TEXT_COLOR;
        ctx.shadowBlur = 15;
        ctx.fillText('COSMIC ASSAULT', width / 2, height * 0.3);
        ctx.fillText('COSMIC ASSAULT', width / 2, height * 0.3);
        ctx.shadowBlur = 0;

        ctx.font = `20px ${DEFAULT_FONT}`;
        const instructionY = height * 0.5;
        if (this.isMobile) {
            ctx.fillText('Use Joystick to Move & Aim', width / 2, instructionY);
            ctx.fillText('Press FIRE Button to Shoot', width / 2, instructionY + 30);
        } else {
            ctx.fillText('Arrow Keys to Move & Aim', width / 2, instructionY);
            ctx.fillText('Spacebar to Shoot', width / 2, instructionY + 30);
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('Destroy Asteroids - Collect Powerups', width / 2, instructionY + 60);

        ctx.font = `24px ${DEFAULT_FONT}`;
        ctx.fillStyle = '#FFFF00';
        ctx.fillText(`HIGH SCORE: ${state.highScore}`, width / 2, instructionY + 110);

        ctx.font = `28px ${DEFAULT_FONT}`;
        ctx.fillStyle = '#FFFFFF';
        const promptText = this.isMobile ? 'TAP SCREEN TO START' : 'PRESS ANY KEY TO START';
        if (Math.floor(Date.now() / 500) % 2 === 0) {
            ctx.fillText(promptText, width / 2, height * 0.8);
        }

        ctx.restore();
    }

    _drawGameOverScreen() {
        const { ctx, state } = this;
        const { width, height } = state;

        state.asteroids.forEach(a => a.draw(ctx));
        state.particles.forEach(p => p.draw(ctx));

        ctx.save();
        ctx.textAlign = 'center';

        ctx.font = `bold 70px ${DEFAULT_FONT}`;
        ctx.fillStyle = '#FF0000';
        ctx.shadowColor = '#FF0000';
        ctx.shadowBlur = 20;
        ctx.fillText('GAME OVER', width / 2, height * 0.3);
        ctx.fillText('GAME OVER', width / 2, height * 0.3);
        ctx.shadowBlur = 0;

        ctx.font = `30px ${DEFAULT_FONT}`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(`FINAL SCORE: ${state.score}`, width / 2, height * 0.5);

        ctx.font = `24px ${DEFAULT_FONT}`;
        ctx.fillStyle = '#FFFF00';
        ctx.fillText(`HIGH SCORE: ${state.highScore}`, width / 2, height * 0.5 + 45);

        if (state.score === state.highScore && state.score > 0) {
            ctx.font = `bold 28px ${DEFAULT_FONT}`;
            ctx.fillStyle = '#FF00FF';
            ctx.shadowColor = '#FF00FF';
            ctx.shadowBlur = 10;
            ctx.fillText('NEW HIGH SCORE!', width / 2, height * 0.5 + 90);
            ctx.shadowBlur = 0;
        }

        ctx.font = `28px ${DEFAULT_FONT}`;
        ctx.fillStyle = '#FFFFFF';
        const promptText = this.isMobile ? 'TAP RESTART BUTTON' : "PRESS 'R' TO RESTART";
        if (Math.floor(Date.now() / 500) % 2 === 0) {
            ctx.fillText(promptText, width / 2, height * 0.8);
        }

        ctx.restore();
    }
}
