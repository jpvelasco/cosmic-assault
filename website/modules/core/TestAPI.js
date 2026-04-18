import {
    SHIP_SIZE,
    POWERUP_TYPES,
    POWERUP_CONFIG,
    LEVEL_THRESHOLDS
} from './constants.js';
import { GravityField } from '../entities/GravityField.js';

export function exposeTestAPI(game) {
    if (typeof window === 'undefined') return;

    const { state, input, canvas } = game;

    window.__COSMIC_ASSAULT_TEST_API__ = {
        version: '2.0.0',
        getState: () => ({
            ...state.getSnapshot(),
            isMobileControlsActive: game.isMobile
        }),
        getPlayer: () => state.player ? state.player.getState() : null,
        getEntityCounts: () => state.getEntityCounts(),
        getAsteroids: () => state.asteroids.map(a => ({ x: a.x, y: a.y, size: a.size, radius: a.radius, isMeteor: a.isMeteor })),
        getPowerups: () => state.powerups.map(p => ({ x: p.x, y: p.y, type: p.type, lifespan: p.lifespan })),
        getGravityFields: () => state.gravityFields.map(f => ({
            x: f.x, y: f.y, radius: f.radius, strength: f.strength,
            active: f.active, lifespan: f.lifespan, isPull: f.strength > 0
        })),
        spawnGravityField: (x, y, radius = 150, strength = 1) => {
            const field = new GravityField(x, y, radius, strength);
            state.gravityFields.push(field);
            return { x: field.x, y: field.y, radius: field.radius, strength: field.strength };
        },
        setGameLevel: (level) => { state.gameLevel = level; },
        getCanvasDimensions: () => ({ width: state.width, height: state.height }),
        simulateKeyDown: (key) => input.simulateKeyDown(key),
        simulateKeyUp: (key) => input.simulateKeyUp(key),
        simulateKeyPress: (key, durationMs = 100) => {
            input.simulateKeyDown(key);
            setTimeout(() => input.simulateKeyUp(key), durationMs);
        },
        simulateJoystick: (angle, distance) => input.simulateJoystick(angle, distance),
        releaseJoystick: () => input.releaseJoystick(),
        startGame: () => game._handleStartInput() || game._handleRestartInput(),
        waitForState: (targetState, timeoutMs = 5000) => new Promise((resolve, reject) => {
            const startTime = Date.now();
            const check = () => {
                if (state.gameState === targetState) resolve(state.gameState);
                else if (Date.now() - startTime > timeoutMs) reject(new Error(`Timeout waiting for state: ${targetState}`));
                else requestAnimationFrame(check);
            };
            check();
        }),
        waitForCondition: (conditionFn, timeoutMs = 5000) => new Promise((resolve, reject) => {
            const startTime = Date.now();
            const check = () => {
                try {
                    if (conditionFn()) resolve(true);
                    else if (Date.now() - startTime > timeoutMs) reject(new Error('Timeout waiting for condition'));
                    else requestAnimationFrame(check);
                } catch (e) { reject(e); }
            };
            check();
        }),
        getConfig: () => ({
            SHIP_SIZE,
            POWERUP_TYPES: [...POWERUP_TYPES],
            POWERUP_CONFIG: { ...POWERUP_CONFIG },
            levelThresholds: [...LEVEL_THRESHOLDS]
        }),
        isReady: () => !!(canvas && game.ctx && state.gameState)
    };

    window.__COSMIC_ASSAULT_TEST_API_READY__ = true;
    console.log('[Cosmic Assault] Test API loaded (v2.0.0 - Modular)');
}
