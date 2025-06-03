// neopixel.js
const { logger } = require('../../../utils/logger');
const NeopixelController = require('./NeopixelController');

class Neopixel {
    /**
     * Initialize the Neopixel controller
     * @param {Object} options - Configuration options
     * @param {number} options.pin - GPIO pin number
     * @param {number} options.count - Number of LEDs
     * @param {number} options.brightness - Initial brightness (0-255)
     * @param {number} options.freq - LED strip frequency
     * @param {number} options.dma - DMA channel
     * @param {number} options.channel - PWM channel
     */
    constructor({
                    pin = 18,
                    count = 300,
                    brightness = 255,
                    freq = 800000,
                    dma = 10,
                    channel = 0
                } = {}) {
        this.ledCount = count;
        this.gpio = pin;
        this.currentState = {
            brightness: brightness,
            animation: null,
            color: 0,
            speed: 50,
            running: false,
            pixels: []
        };

        // Create Neopixel controller
        this.controller = new NeopixelController({
            ledCount: count,
            pin: pin,
            brightness: brightness,
            freq: freq,
            dma: dma,
            channel: channel
        });

        // Set up callbacks for state changes
        this.stateChangeCallback = null;

        // Set up interval for state updates during animations
        this.stateUpdateInterval = null;
        this.stateUpdateFrequency = 500; // ms between state updates

        logger.info(`Initialized Neopixel with ${count} LEDs on pin ${pin}`);
    }

    convertColor(color) {
        const red = (color >> 16) & 0xFF;
        const green = (color >> 8) & 0xFF;
        const blue = color & 0xFF;

        // Reassemble in GGRRBB format
        return (green << 16) | (red << 8) | blue;
    }
    /**
     * Handle MQTT messages
     * @param {Object} message - MQTT message
     */
    handleMessage(message) {
        try {
            const command = message?.command;

            if (!command) {
                logger.error("No command specified in message");
                return;
            }

            logger.info(`Received command: ${command}`);

            switch (command) {
                case 'power':
                    this.setPower(message.parameters.power, message.parameters.color);
                    break;

                case 'startAnimation':
                    this.startAnimation(
                        message.parameters.animation,
                        this.convertColor(this.currentState.color),
                        message.parameters?.speed ?? 50
                    );
                    break;

                case 'stopAnimation':
                    this.stop();
                    break;

                case 'setAnimationSpeed':
                    this.setAnimationSpeed(message.parameters.speed);
                    break;

                case 'setColor':
                    this.setColor(
                        message.parameters.color,
                        message.parameters.start,
                        message.parameters.end
                    );
                    break;

                case 'setBrightness':
                    this.setBrightness(
                        message.parameters.brightness,
                        message.parameters.start,
                        message.parameters.end
                    );
                    break;

                case 'clear':
                    this.clear();
                    break;

                default:
                    logger.error(`Unknown command: ${command}`);
            }
        } catch (error) {
            logger.error(`Error handling device message: ${error.message}`);
            return { error: error.message, message };
        }
    }

    setPower(power, color = 0xFFFFFF) {
        if (power) {
            this.setColor(color);
        } else {
            this.clear();
        }
    }

    /**
     * Set the number of pixels
     * @param {number} num - Number of pixels
     */
    setNumPixels(num) {
        this.ledCount = num;
        // Update the controller with the new number of pixels
        this.controller.setNumPixels(num);

        // Update state
        this.updateState({
            ledCount: num
        }, true);
    }

    /**
     * Start an animation
     * @param {string} animation - Animation name
     * @param {number} color - Color value (0xRRGGBB)
     * @param {number} speed - Animation speed
     */
    async startAnimation(animation, color = 0xFFFFFF, speed = 50) {
        this.stop();

        this.stopStateUpdates();

        // Start periodic state updates
        this.startStateUpdates();

        // Update state before starting animation
        setTimeout(() => { this.updateState({
            power: true,
            animation,
            speed,
            running: true
        }); }, 100);

        try {
            // Start the animation and await its completion
            logger.info(`Starting animation ${animation}`);
            await this.controller.startAnimation(animation, color, speed);
        } catch (error) {
            console.error("Animation error:", error);
        }

        logger.info("Animation complete");

        // When animation completes or is stopped
        this.stopStateUpdates();

        // Update state one final time
        this.updateState({
            running: false,
            animation: null
        }, true);
    }

    setAnimationSpeed(speed) {
        // Update the current state's speed
        this.currentState.speed = speed;

        this.controller.setAnimationSpeed(speed);

        // Update state and trigger callback
        this.updateState({ speed }, true);

        logger.info(`Animation speed set to: ${speed}`);
    }

    /**
     * Set a static color
     * @param {number} color - Color value (0xRRGGBB)
     * @param {number} start - Start LED index
     * @param {number} end - End LED index
     */
    setColor(color = 0xFFFFFF, start = null, end = null) {
        logger.info("Setting static color to: ", color);
        this.controller.staticColor(this.convertColor(color), start, end);

        // Update state
        this.updateState({
            power: true,
            color,
            animation: null,
            running: false
        }, true);
    }

    /**
     * Set brightness
     * @param {number} brightness - Brightness value (0-255)
     * @param {number} start - Start LED index
     * @param {number} end - End LED index
     */
    setBrightness(brightness = 255, start = null, end = null) {
        logger.info("Setting brightness to: ", brightness);
        this.controller.setBrightness(brightness, start, end);

        // Update state
        this.updateState({
            power: true,
            brightness: brightness
        }, true);
    }

    /**
     * Stop the current animation
     */
    stop() {
        logger.info('Stopping current animation');
        this.controller.stopAnimation();

        // Stop periodic state updates
        this.stopStateUpdates();

        // Update state
        this.updateState({
            running: false
        }, true);
    }

    /**
     * Clear all LEDs
     */
    clear() {
        logger.info('Clearing all LEDs');
        this.controller.clear();

        // Update state
        this.updateState({
            power: false,
            animation: null,
            running: false
        }, true);
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.controller.clear();
        this.stopStateUpdates();
        this.controller.cleanup();
    }

    /**
     * Set callback for state changes
     * @param {Function} callback - Function to call when state changes
     */
    onStateChange(callback) {
        this.stateChangeCallback = callback;
    }

    /**
     * Update the current state and trigger the callback
     * @param {Object} stateUpdates - Partial state updates to apply
     * @param {boolean} updatePixels - Whether to include pixel data in the update
     */
    updateState(stateUpdates, updatePixels = false) {
        // Update state
        this.currentState = { ...this.currentState, ...stateUpdates };

        // Optionally update pixel data
        if (updatePixels) {
            this.updatePixelState();
        }

        // Trigger callback
        if (this.stateChangeCallback) {
            const state = this.getState();
            logger.info("Current state: ", { ...state, pixels: undefined });
            this.stateChangeCallback(state);
        }
    }

    /**
     * Update the pixel state from the controller
     */
    updatePixelState() {
        // Get pixel data from controller using the new getter
        const pixelsArray = this.controller.getPixels();
        this.currentState.pixels = Array.from(pixelsArray)
            .map((color, index) => ({ index, color }));
    }

    /**
     * Start periodic state updates during animation
     */
    startStateUpdates() {
        if (this.stateUpdateInterval) {
            clearInterval(this.stateUpdateInterval);
        }

        this.stateUpdateInterval = setInterval(() => {
            this.updatePixelState();

            if (this.stateChangeCallback) {
                this.stateChangeCallback(this.getState());
            }
        }, this.stateUpdateFrequency);
    }

    /**
     * Stop periodic state updates
     */
    stopStateUpdates() {
        if (this.stateUpdateInterval) {
            clearInterval(this.stateUpdateInterval);
            this.stateUpdateInterval = null;
        }
    }

    /**
     * Get the current state
     * @param {boolean} includePixels - Whether to include pixel data
     * @returns {Object} Current state
     */
    getState(includePixels = true) {
        if (includePixels && this.currentState.pixels.length === 0) {
            this.updatePixelState();
        }

        // Return a copy of the state to prevent modification
        return { ...this.currentState };
    }
}

module.exports = Neopixel;