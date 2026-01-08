/**
 * Audio System
 * Handles all game audio using Web Audio API
 */

/**
 * Sound definitions for procedural audio
 */
const SOUND_DEFINITIONS = {
    shoot: {
        oscType: 'sawtooth',
        freq1: 900,
        freq2: 100,
        gainVal: 0.2,
        decay: 0.1,
        freqDecay: 'exponential',
        volDecay: 'exponential'
    },
    explosion: {
        oscType: 'square',
        freq1: 160,
        freq2: 30,
        gainVal: 0.25,
        decay: 0.3,
        freqDecay: 'exponential',
        volDecay: 'exponential',
        useNoise: true,
        noiseDuration: 0.25,
        noiseGain: 0.15,
        noiseDelay: 0.03
    },
    nuke: {
        oscType: 'sine',
        freq1: 120,
        freq2: 30,
        gainVal: 0.6,
        decay: 1.0,
        freqDecay: 'exponential',
        volDecay: 'exponential',
        useNoise: true,
        noiseDuration: 0.8,
        noiseGain: 0.2,
        noiseDelay: 0
    },
    powerup: {
        oscType: 'triangle',
        freq1: 440,
        freq2: 880,
        gainVal: 0.3,
        decay: 0.2,
        freqDecay: 'linear',
        volDecay: 'linear'
    },
    gameover: {
        oscType: 'sine',
        freq1: 440,
        freq2: 110,
        gainVal: 0.4,
        decay: 0.8,
        freqDecay: 'exponential',
        volDecay: 'exponential'
    },
    levelup: {
        oscType: 'triangle',
        freq1: 523,
        freq2: 1046,
        gainVal: 0.35,
        decay: 0.4,
        freqDecay: 'linear',
        volDecay: 'linear'
    },
    highscore: {
        oscType: 'triangle',
        freq1: 523,
        freq2: 1568,
        gainVal: 0.4,
        decay: 0.8,
        freqDecay: 'linear',
        volDecay: 'linear'
    },
    thrust: {
        oscType: 'sawtooth',
        freq1: 80,
        freq2: 60,
        gainVal: 0.08,
        decay: 0.15,
        freqDecay: 'linear',
        volDecay: 'linear',
        useNoise: true,
        noiseDuration: 0.1,
        noiseGain: 0.05,
        noiseDelay: 0
    }
};

/**
 * Audio system using Web Audio API
 */
export class AudioSystem {
    constructor() {
        this.audioContext = null;
        this.enabled = true;
        this.initialized = false;
    }

    /**
     * Initialize the audio context
     */
    initialize() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.initialized = true;

            // Set up resume on first interaction
            const resumeAudio = () => {
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                document.removeEventListener('click', resumeAudio);
                document.removeEventListener('touchstart', resumeAudio);
                document.removeEventListener('keydown', resumeAudio);
            };

            document.addEventListener('click', resumeAudio, { once: true });
            document.addEventListener('touchstart', resumeAudio, { once: true });
            document.addEventListener('keydown', resumeAudio, { once: true });

        } catch (e) {
            console.error("Web Audio API is not supported:", e);
            this.enabled = false;
        }
    }

    /**
     * Play a sound effect
     * @param {string} type - Sound type from SOUND_DEFINITIONS
     */
    play(type) {
        if (!this.enabled || !this.audioContext || this.audioContext.state !== 'running') {
            return;
        }

        const def = SOUND_DEFINITIONS[type];
        if (!def) return;

        const now = this.audioContext.currentTime;

        // Create oscillator
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        osc.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        osc.type = def.oscType;
        gainNode.gain.setValueAtTime(def.gainVal, now);
        osc.frequency.setValueAtTime(def.freq1, now);

        // Frequency decay
        if (def.freqDecay === 'exponential') {
            osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, def.freq2), now + def.decay);
        } else {
            osc.frequency.linearRampToValueAtTime(Math.max(0.01, def.freq2), now + def.decay);
        }

        // Volume decay
        if (def.volDecay === 'exponential') {
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + def.decay * 1.1);
        } else {
            gainNode.gain.linearRampToValueAtTime(0.0001, now + def.decay * 1.1);
        }

        osc.start(now);
        osc.stop(now + def.decay * 1.1);

        // Noise component
        if (def.useNoise) {
            const noiseDelay = def.noiseDelay || 0;
            setTimeout(() => {
                if (!this.enabled || this.audioContext.state !== 'running') return;

                const noise = this._createNoiseGenerator();
                const noiseGainNode = this.audioContext.createGain();
                noise.connect(noiseGainNode);
                noiseGainNode.connect(this.audioContext.destination);

                const currentTime = this.audioContext.currentTime;
                noiseGainNode.gain.setValueAtTime(def.noiseGain, currentTime);
                noiseGainNode.gain.exponentialRampToValueAtTime(0.0001, currentTime + def.noiseDuration);

                noise.start(currentTime);
                noise.stop(currentTime + def.noiseDuration);
            }, noiseDelay * 1000);
        }
    }

    /**
     * Create a noise generator
     * @returns {AudioBufferSourceNode}
     * @private
     */
    _createNoiseGenerator() {
        const bufferSize = this.audioContext.sampleRate * 0.5;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        return whiteNoise;
    }

    /**
     * Toggle sound enabled state
     * @returns {boolean} New enabled state
     */
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    /**
     * Set enabled state
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Check if audio is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Resume audio context (for user interaction requirement)
     */
    resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }
}
