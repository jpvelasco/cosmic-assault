/**
 * Cosmic Assault - Modules Index
 * Main entry point for the modular game architecture
 */

// Core
export { Game } from './core/Game.js';
export { GameState } from './core/GameState.js';
export * from './core/constants.js';

// Entities
export * from './entities/index.js';

// Systems
export * from './systems/index.js';

// Utils
export * from './utils/index.js';
