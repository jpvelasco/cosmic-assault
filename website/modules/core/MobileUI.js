import { GAME_STATES } from './constants.js';

export class MobileUI {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
    }

    attach() {
        window.addEventListener('resize', () => this.resizeCanvas());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.checkOrientation(), 100);
        });

        const mobileControlsEl = document.querySelector('.mobile-controls');
        if (mobileControlsEl) {
            mobileControlsEl.style.display = 'block';
        }

        this.checkOrientation();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.state.setDimensions(this.canvas.width, this.canvas.height);
    }

    checkOrientation() {
        const orientationMessageEl = document.getElementById('orientation-message');
        const mobileControlsEl = document.querySelector('.mobile-controls');

        if (!orientationMessageEl || !this.canvas) return;

        const isPortrait = window.innerHeight > window.innerWidth;

        orientationMessageEl.style.display = isPortrait ? 'flex' : 'none';
        this.canvas.style.display = isPortrait ? 'none' : 'block';
        if (mobileControlsEl) {
            mobileControlsEl.style.display = isPortrait ? 'none' : 'block';
        }

        if (isPortrait && this.state.gameState === GAME_STATES.PLAYING) {
            this.state.previousGameState = this.state.gameState;
            this.state.gameState = GAME_STATES.PAUSED;
        }

        if (!isPortrait && this.state.gameState === GAME_STATES.PAUSED && this.state.previousGameState === GAME_STATES.PLAYING) {
            this.state.gameState = GAME_STATES.PLAYING;
            this.state.previousGameState = null;
        }

        if (!isPortrait) {
            this.resizeCanvas();
        }
    }

    showRestartButton() {
        const btn = document.getElementById('restart-button');
        if (btn) btn.style.display = 'block';
    }

    hideRestartButton() {
        const btn = document.getElementById('restart-button');
        if (btn) btn.style.display = 'none';
    }
}
