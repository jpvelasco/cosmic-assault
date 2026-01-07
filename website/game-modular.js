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

    // Keyboard ghosting notification
    const GHOSTING_DISMISSED_KEY = 'cosmicAssault_ghostingDismissed';

    // Create ghosting modal
    const ghostingModal = document.createElement('div');
    ghostingModal.id = 'ghosting-modal';
    ghostingModal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10001;justify-content:center;align-items:center;';
    ghostingModal.innerHTML = `
        <div style="background:#111;border:2px solid #39ff14;border-radius:10px;padding:30px;max-width:450px;margin:20px;text-align:center;font-family:'Courier New',monospace;color:#39ff14;box-shadow:0 0 30px rgba(57,255,20,0.3);">
            <h2 style="margin:0 0 15px 0;font-size:24px;text-shadow:0 0 10px #39ff14;">⌨️ Keyboard Limitation Detected</h2>
            <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#ccc;">
                Your keyboard can't register <strong style="color:#ff5555;">Arrow + Arrow + Space</strong> simultaneously.
                This is a hardware limitation called "ghosting" common in non-gaming keyboards.
            </p>
            <div style="background:#1a1a1a;border-radius:8px;padding:15px;margin:0 0 20px 0;text-align:left;">
                <div style="font-size:13px;color:#39ff14;margin-bottom:10px;"><strong>Try these alternatives:</strong></div>
                <div style="font-size:13px;color:#aaa;margin-bottom:8px;">• <strong style="color:#fff;">WASD</strong> + <strong style="color:#fff;">Space</strong> — W=thrust, A/D=turn</div>
                <div style="font-size:13px;color:#aaa;">• <strong style="color:#fff;">Arrows</strong> + <strong style="color:#fff;">Shift</strong> — Use Shift to fire instead</div>
            </div>
            <label style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:20px;cursor:pointer;font-size:13px;color:#888;">
                <input type="checkbox" id="ghosting-dont-show" style="width:16px;height:16px;cursor:pointer;">
                <span>Don't show this again</span>
            </label>
            <button id="ghosting-dismiss" style="background:#39ff14;color:#000;border:none;padding:12px 30px;font-size:16px;font-weight:bold;border-radius:5px;cursor:pointer;font-family:inherit;transition:all 0.2s;">GOT IT</button>
        </div>
    `;
    document.body.appendChild(ghostingModal);

    // Style the button hover
    const ghostingBtn = document.getElementById('ghosting-dismiss');
    ghostingBtn.addEventListener('mouseover', () => {
        ghostingBtn.style.background = '#5fff5f';
        ghostingBtn.style.transform = 'scale(1.05)';
    });
    ghostingBtn.addEventListener('mouseout', () => {
        ghostingBtn.style.background = '#39ff14';
        ghostingBtn.style.transform = 'scale(1)';
    });

    // Handle dismiss
    ghostingBtn.addEventListener('click', () => {
        const dontShow = document.getElementById('ghosting-dont-show').checked;
        if (dontShow) {
            localStorage.setItem(GHOSTING_DISMISSED_KEY, 'true');
        }
        ghostingModal.style.display = 'none';
    });

    // Set up ghosting detection callback
    game.input.onGhostingDetected(() => {
        // Check if user has dismissed before
        if (localStorage.getItem(GHOSTING_DISMISSED_KEY) === 'true') {
            return;
        }
        ghostingModal.style.display = 'flex';
    });

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
