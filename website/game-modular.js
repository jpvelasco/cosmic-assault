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

    // Debug overlay for keyboard diagnostics
    let debugMode = false;
    const debugOverlay = document.createElement('div');
    debugOverlay.id = 'debug-overlay';
    debugOverlay.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.8);color:#39ff14;font-family:monospace;font-size:12px;padding:10px;border:1px solid #39ff14;z-index:10000;display:none;min-width:200px;';
    document.body.appendChild(debugOverlay);

    // Update debug display
    function updateDebugOverlay() {
        if (!debugMode) return;
        const inputState = game.input.getState();
        const keys = inputState.keys;
        const activeKeys = Object.entries(keys).filter(([k, v]) => v).map(([k]) => k);
        const firePressed = keys[' '] || keys['Shift'];
        const leftPressed = keys['ArrowLeft'] || keys['a'] || keys['A'];
        const rightPressed = keys['ArrowRight'] || keys['d'] || keys['D'];
        const upPressed = keys['ArrowUp'] || keys['w'] || keys['W'];
        debugOverlay.innerHTML = `
            <div><b>KEY DEBUG (D to hide)</b></div>
            <div>---ARROWS or WASD---</div>
            <div>Turn Left (←/A): ${leftPressed ? '✓' : '✗'}</div>
            <div>Turn Right (→/D): ${rightPressed ? '✓' : '✗'}</div>
            <div>Thrust (↑/W): ${upPressed ? '✓' : '✗'}</div>
            <div>Fire (Space/Shift): ${firePressed ? '✓' : '✗'}</div>
            <div>---</div>
            <div>Joystick: ${inputState.joystickActive ? 'ACTIVE' : 'off'}</div>
        `;
        requestAnimationFrame(updateDebugOverlay);
    }

    // Handle keyboard events for title/game over screens
    window.addEventListener('keydown', (e) => {
        const key = e.key.toUpperCase();
        const state = game.state.gameState;

        // Toggle debug mode with 'D'
        if (key === 'D' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            debugMode = !debugMode;
            debugOverlay.style.display = debugMode ? 'block' : 'none';
            if (debugMode) updateDebugOverlay();
            return;
        }

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
