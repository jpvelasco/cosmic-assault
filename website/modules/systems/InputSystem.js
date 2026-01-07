/**
 * Input System
 * Handles keyboard and touch/joystick input
 */

/**
 * Input handling system
 */
export class InputSystem {
    constructor() {
        // Keyboard state
        this.keys = {};

        // Joystick state
        this.joystickActive = false;
        this.joystickAngle = 0;
        this.joystickDistance = 0;
        this.joystickTouchId = null;

        // Mobile state
        this.isMobileControlsActive = false;

        // DOM elements
        this.joystickBaseEl = null;
        this.joystickHandleEl = null;
        this.fireButtonEl = null;
        this.arrowEls = {};

        // Callbacks
        this.onStartGame = null;
        this.onRestartGame = null;
    }

    /**
     * Initialize input system
     * @param {Object} options - Configuration options
     */
    initialize(options = {}) {
        const {
            isMobile = false,
            testMode = false,
            onStartGame = null,
            onRestartGame = null,
            canvas = null
        } = options;

        this.isMobileControlsActive = isMobile || testMode;
        this.onStartGame = onStartGame;
        this.onRestartGame = onRestartGame;

        // Get DOM elements
        this.joystickBaseEl = document.getElementById('joystick-base');
        this.joystickHandleEl = document.getElementById('joystick-handle');
        this.fireButtonEl = document.getElementById('fire-button');
        this.arrowEls = {
            up: document.getElementById('up-arrow'),
            down: document.getElementById('down-arrow'),
            left: document.getElementById('left-arrow'),
            right: document.getElementById('right-arrow')
        };

        // Set up event listeners
        this._setupKeyboardListeners();

        if (this.isMobileControlsActive) {
            this._setupMobileListeners(canvas);
        }
    }

    /**
     * Set up keyboard event listeners
     * @private
     */
    _setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => this._handleKeyDown(e));
        window.addEventListener('keyup', (e) => this._handleKeyUp(e));
    }

    /**
     * Handle key down
     * @param {KeyboardEvent} e
     * @private
     */
    _handleKeyDown(e) {
        const key = e.key.toUpperCase();

        // Store key state
        this.keys[e.key] = true;
        this.keys[key] = true;

        // Prevent spacebar scrolling
        if (e.key === ' ') {
            e.preventDefault();
        }
    }

    /**
     * Handle key up
     * @param {KeyboardEvent} e
     * @private
     */
    _handleKeyUp(e) {
        this.keys[e.key] = false;
        this.keys[e.key.toUpperCase()] = false;
    }

    /**
     * Set up mobile/touch listeners
     * @param {HTMLCanvasElement} canvas
     * @private
     */
    _setupMobileListeners(canvas) {
        if (!this.joystickBaseEl || !this.fireButtonEl) {
            console.warn("Mobile control elements not found");
            return;
        }

        // Joystick listeners
        this.joystickBaseEl.addEventListener('touchstart', (e) => this._handleTouchStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this._handleTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this._handleTouchEnd(e), { passive: false });
        document.addEventListener('touchcancel', (e) => this._handleTouchEnd(e), { passive: false });

        // Fire button
        this.fireButtonEl.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.keys[' '] = true;
        }, { passive: false });
        this.fireButtonEl.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.keys[' '] = false;
        }, { passive: false });
        this.fireButtonEl.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            this.keys[' '] = false;
        }, { passive: false });

        // Mouse simulation for testing
        this.joystickBaseEl.addEventListener('mousedown', (e) => this._handleTouchStart(e));
        document.addEventListener('mousemove', (e) => this._handleTouchMove(e));
        document.addEventListener('mouseup', (e) => this._handleTouchEnd(e));
        this.fireButtonEl.addEventListener('mousedown', () => this.keys[' '] = true);
        this.fireButtonEl.addEventListener('mouseup', () => this.keys[' '] = false);

        // Canvas touch for starting game
        if (canvas) {
            canvas.addEventListener('touchstart', (e) => {
                if (this.onStartGame) {
                    e.preventDefault();
                    this.onStartGame();
                }
            }, { passive: false });
        }
    }

    /**
     * Handle touch start on joystick
     * @param {TouchEvent|MouseEvent} e
     * @private
     */
    _handleTouchStart(e) {
        if (!this.isMobileControlsActive) return;
        e.preventDefault();

        let touch;
        if (e.type === 'mousedown') {
            touch = e;
            this.joystickTouchId = 'mouse';
        } else {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.target === this.joystickBaseEl || this.joystickBaseEl.contains(t.target)) {
                    touch = t;
                    this.joystickTouchId = t.identifier;
                    break;
                }
            }
        }

        if (!touch) return;

        this.joystickActive = true;
        this._updateJoystickFromTouch(touch);
    }

    /**
     * Handle touch move
     * @param {TouchEvent|MouseEvent} e
     * @private
     */
    _handleTouchMove(e) {
        if (!this.isMobileControlsActive || !this.joystickActive || this.joystickTouchId === null) return;
        e.preventDefault();

        let touch;
        if (this.joystickTouchId === 'mouse') {
            touch = e;
        } else {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.joystickTouchId) {
                    touch = e.changedTouches[i];
                    break;
                }
            }
        }

        if (touch) {
            this._updateJoystickFromTouch(touch);
        }
    }

    /**
     * Handle touch end
     * @param {TouchEvent|MouseEvent} e
     * @private
     */
    _handleTouchEnd(e) {
        if (!this.isMobileControlsActive || !this.joystickActive || this.joystickTouchId === null) return;

        let touchEnded = false;
        if (this.joystickTouchId === 'mouse' && e.type === 'mouseup') {
            touchEnded = true;
        } else if (e.changedTouches) {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.joystickTouchId) {
                    touchEnded = true;
                    break;
                }
            }
        }

        if (touchEnded) {
            this.joystickActive = false;
            this.joystickTouchId = null;
            this._resetJoystickVisuals();
        }
    }

    /**
     * Update joystick state from touch position
     * @param {Touch|MouseEvent} touch
     * @private
     */
    _updateJoystickFromTouch(touch) {
        const rect = this.joystickBaseEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const deltaX = touch.clientX - centerX;
        const deltaY = touch.clientY - centerY;

        this.joystickAngle = Math.atan2(deltaY, deltaX);
        this.joystickDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        // Update visual
        if (this.joystickHandleEl) {
            const handleRadius = this.joystickHandleEl.offsetWidth / 2;
            const maxTravel = rect.width / 2 - handleRadius;
            const clampedDistance = Math.min(this.joystickDistance, maxTravel);
            const handleX = clampedDistance * Math.cos(this.joystickAngle);
            const handleY = clampedDistance * Math.sin(this.joystickAngle);
            this.joystickHandleEl.style.transform = `translate(${handleX}px, ${handleY}px)`;
        }

        this._updateDirectionHighlights();
    }

    /**
     * Reset joystick visuals to center
     * @private
     */
    _resetJoystickVisuals() {
        if (this.joystickHandleEl) {
            this.joystickHandleEl.style.transform = 'translate(0px, 0px)';
        }
        this._updateDirectionHighlights(false);
    }

    /**
     * Update direction arrow highlights
     * @param {boolean} active
     * @private
     */
    _updateDirectionHighlights(active = true) {
        const highlightColor = 'rgba(57, 255, 20, 1)';
        const highlightShadow = '0 0 10px rgba(57, 255, 20, 0.8)';
        const defaultColor = 'rgba(57, 255, 20, 0.8)';
        const defaultShadow = 'none';

        // Reset all
        Object.values(this.arrowEls).forEach(el => {
            if (el) {
                el.style.color = defaultColor;
                el.style.textShadow = defaultShadow;
            }
        });

        if (!active || this.joystickDistance <= 10) return;

        // Highlight active direction
        const angleDeg = (this.joystickAngle * 180 / Math.PI + 360) % 360;
        let activeArrow = null;

        if (angleDeg >= 45 && angleDeg < 135) activeArrow = this.arrowEls.down;
        else if (angleDeg >= 135 && angleDeg < 225) activeArrow = this.arrowEls.left;
        else if (angleDeg >= 225 && angleDeg < 315) activeArrow = this.arrowEls.up;
        else activeArrow = this.arrowEls.right;

        if (activeArrow) {
            activeArrow.style.color = highlightColor;
            activeArrow.style.textShadow = highlightShadow;
        }
    }

    /**
     * Get current input state
     * @returns {Object}
     */
    getState() {
        return {
            keys: this.keys,
            joystickActive: this.joystickActive,
            joystickAngle: this.joystickAngle,
            joystickDistance: this.joystickDistance
        };
    }

    /**
     * Check if a key is pressed
     * @param {string} key
     * @returns {boolean}
     */
    isKeyPressed(key) {
        return !!this.keys[key];
    }

    /**
     * Reset all input state
     */
    reset() {
        this.keys = {};
        this.joystickActive = false;
        this.joystickAngle = 0;
        this.joystickDistance = 0;
        this._resetJoystickVisuals();
    }

    /**
     * Simulate key press (for testing)
     * @param {string} key
     */
    simulateKeyDown(key) {
        this.keys[key] = true;
    }

    /**
     * Simulate key release (for testing)
     * @param {string} key
     */
    simulateKeyUp(key) {
        this.keys[key] = false;
    }

    /**
     * Simulate joystick (for testing)
     * @param {number} angle
     * @param {number} distance
     */
    simulateJoystick(angle, distance) {
        this.joystickActive = true;
        this.joystickAngle = angle;
        this.joystickDistance = distance;
    }

    /**
     * Release simulated joystick
     */
    releaseJoystick() {
        this.joystickActive = false;
        this.joystickAngle = 0;
        this.joystickDistance = 0;
    }
}
