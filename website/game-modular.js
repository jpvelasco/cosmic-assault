/**
 * Cosmic Assault - Modular Entry Point
 * This file initializes the game using the new modular architecture.
 */

import { Game } from './modules/core/Game.js';

// Wait for DOM to be ready
window.addEventListener('DOMContentLoaded', () => {
    // Get canvas
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }

    // Create and initialize game
    const game = new Game(canvas);
    game.initialize();

    // Start game loop
    game.start();

    // Handle keyboard events for title/game over screens
    window.addEventListener('keydown', (e) => {
        const key = e.key.toUpperCase();
        const state = game.state.gameState;

        // Start game from title
        if (state === 'title' && !e.metaKey && !e.ctrlKey && !e.altKey && key !== 'F5' && key !== 'F12') {
            game._handleStartInput();
        }

        // Restart from game over
        if (state === 'gameOver' && key === 'R') {
            game._handleRestartInput();
        }
    });

    // Restart button for mobile
    const restartBtn = document.getElementById('restart-button');
    if (restartBtn) {
        restartBtn.addEventListener('touchstart', (e) => {
            if (game.state.gameState === 'gameOver') {
                e.preventDefault();
                game._handleRestartInput();
            }
        }, { passive: false });
    }

    console.log('[Cosmic Assault] Game initialized (Modular Architecture v2.0)');
});
