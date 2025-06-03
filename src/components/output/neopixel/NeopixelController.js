// neopixel-controller.js
import { ws281x, StripType } from 'piixel';
import AnimationManager from './animation-manager.js';
import { logger } from '../../../utils/logger.js';

class NeopixelController {
    /**
     * Initialize the LED controller
     * @param {Object} options - Configuration options
     * @param {number} options.ledCount - Number of LEDs in the strip
     * @param {number} options.pin - GPIO pin number
     * @param {number} options.freq - LED strip frequency
     * @param {number} options.dma - DMA channel
     * @param {number} options.brightness - Initial brightness
     * @param {number} options.channel - PWM channel
     */
    constructor({
                    ledCount = 300,
                    pin = 18,
                    freq = 800000,
                    dma = 10,
                    brightness = 255,
                    channel = 0
                } = {}) {
        this.ledCount = ledCount;

        this.brightness = new Array(ledCount).fill(brightness);
        this.animationThread = null;
        this.running = false;
        this.animationManager = new AnimationManager();

        // Initialize the LED strip
        ws281x.configure({
            gpio: pin,
            leds: ledCount,
            frequency: freq,
            dma: dma,
            brightness: brightness / 255,
            stripType: StripType.WS2811_STRIP_GRB,
            invert: false,
            channel: channel
        });

        // Create pixel buffer
        this.pixels = new Uint32Array(ledCount);

        logger.info(`Initialized LED strip with ${ledCount} LEDs on pin ${pin}`);
    }

    /**
     * Validate and normalize start and end indices
     * @param {number|null} startIndex - Start index (null for 0)
     * @param {number|null} endIndex - End index (null for last LED)
     * @returns {Array} [startIndex, endIndex]
     */
    _validateIndices(startIndex = null, endIndex = null) {
        const stripLength = this.ledCount;

        if (startIndex === null && endIndex === null) {
            return [0, stripLength - 1];
        }

        startIndex = startIndex === null ? 0 : Math.max(0, Math.min(startIndex, stripLength - 1));
        endIndex = endIndex === null ? stripLength - 1 : Math.max(0, Math.min(endIndex, stripLength - 1));

        if (startIndex > endIndex) {
            [startIndex, endIndex] = [endIndex, startIndex];
        }

        return [startIndex, endIndex];
    }

    /**
     * Set a static color for a range of LEDs
     * @param {number} color - Color value (0xRRGGBB)
     * @param {number|null} startIndex - Start index (null for all LEDs)
     * @param {number|null} endIndex - End index (null for all LEDs)
     */
    staticColor(color, startIndex = null, endIndex = null) {
        // Stop any animation in progress
        this.stopAnimation();

        const [start, end] = this._validateIndices(startIndex, endIndex);

        for (let i = start; i <= end; i++) {
            this.pixels[i] = color;
        }

        this.render(this.getPixelsWithBrightness());
        logger.info(`Set static color 0x${color.toString(16)} for LEDs ${start}-${end}`);
    }

    /**
     * Set the brightness for a range of LEDs
     * @param {number} brightness - Brightness value (0-255)
     * @param {number|null} startIndex - Start index (null for all LEDs)
     * @param {number|null} endIndex - End index (null for all LEDs)
     */
    setBrightness(brightness, startIndex = null, endIndex = null) {
        const [start, end] = this._validateIndices(startIndex, endIndex);

        // Clamp brightness to valid range
        brightness = Math.min(Math.max(brightness, 0), 255);

        // If adjusting the entire strip, use the hardware brightness control
        for (let i = start ?? 0; i <= end ?? this.ledCount; i++) {
            this.brightness[i] = brightness;
        }

        this.render(this.getPixelsWithBrightness());
    }

    getPixelsWithBrightness() {
        // Use brightness to adjust each pixel as needed
        return this.pixels.map((color, index) => {
            const r = (color >> 16) & 0xFF;
            const g = (color >> 8) & 0xFF;
            const b = color & 0xFF;

            // Scale colors by brightness
            const adjR = Math.floor((r * this.brightness[index]) / 255);
            const adjG = Math.floor((g * this.brightness[index]) / 255);
            const adjB = Math.floor((b * this.brightness[index]) / 255);

            return (adjR << 16) | (adjG << 8) | adjB;
        });
    }

    /**
     * Set multiple colors across the strip
     * @param {Array} colors - Array of color values
     * @param {boolean} gradient - Whether to create a gradient between colors
     */
    setMultipleColors(colors = [], gradient = false) {
        if (colors.length === 0) return;

        this.stopAnimation();

        if (gradient && colors.length > 1) {
            // Create gradient across the strip
            const numPixels = this.ledCount;
            const numSegments = colors.length - 1;
            const pixelsPerSegment = numPixels / numSegments;

            for (let segment = 0; segment < numSegments; segment++) {
                const startColor = colors[segment];
                const endColor = colors[segment + 1];

                const startR = (startColor >> 16) & 0xFF;
                const startG = (startColor >> 8) & 0xFF;
                const startB = startColor & 0xFF;

                const endR = (endColor >> 16) & 0xFF;
                const endG = (endColor >> 8) & 0xFF;
                const endB = endColor & 0xFF;

                const startPixel = Math.floor(segment * pixelsPerSegment);
                const endPixel = Math.floor((segment + 1) * pixelsPerSegment);

                for (let i = startPixel; i < endPixel; i++) {
                    const progress = (i - startPixel) / (endPixel - startPixel);

                    const r = Math.floor(startR + (endR - startR) * progress);
                    const g = Math.floor(startG + (endG - startG) * progress);
                    const b = Math.floor(startB + (endB - startB) * progress);

                    this.pixels[i] = (r << 16) | (g << 8) | b;
                }
            }
        } else {
            // Distribute colors evenly
            const pixelsPerColor = Math.floor(this.ledCount / colors.length);

            for (let i = 0; i < colors.length; i++) {
                const startPixel = i * pixelsPerColor;
                const endPixel = (i === colors.length - 1) ? this.ledCount : (i + 1) * pixelsPerColor;

                for (let j = startPixel; j < endPixel; j++) {
                    this.pixels[j] = colors[i];
                }
            }
        }

        this.render(this.getPixelsWithBrightness());
    }

    /**
     * Start a new animation
     * @param {string} animationName - Name of the animation
     * @param {number} color - Color value (default: white)
     * @param {number} speed - Animation speed (default: 50ms)
     */
    async startAnimation(animationName, color = 0xFFFFFF, speed = 50) {
        // Force stop any running animation
        await this.forceStopAnimation();

        const animationFunc = this.animationManager.getAnimation(animationName);
        if (!animationFunc) {
            logger.error(`Animation ${animationName} not found`);
            return;
        }

        this.running = true;

        try {
            if (animationName === 'static') {
                this.staticColor(color);
            } else {
                // Clear previous animation state
                this.clear();

                // Start the animation in a way that can be stopped
                this.animationThread = this._runAnimation(animationFunc, color, speed);

                logger.info(`Starting animation ${animationName}`);

                // Wait for animation to complete
                await this.animationThread;
            }
        } catch (error) {
            logger.error(`Error running animation ${animationName}: ${error.message}`);
        } finally {
            logger.info(`Animation ${animationName} complete or stopped`);
            this.running = false;
            this.animationThread = null;
        }
    }

    setAnimationSpeed(speed) {
        this.currentSpeed = speed;
    }

    async forceStopAnimation() {
        // Set the running flag to false
        this.running = false;

        // If there's an active animation promise, wait for it to resolve
        if (this.animationThread) {
            logger.info('Force stopping previous animation');

            // Wait a reasonable time for the animation to stop naturally
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 100));
            await Promise.race([this.animationThread, timeoutPromise]);

            // Clear the animation promise
            this.animationThread = null;
        }
    }

    /**
     * Get a copy of the current pixels array
     * @returns {Uint32Array} Current pixels
     */
    getPixels() {
        return new Uint32Array(this.pixels);
    }

    /**
     * Get a specific pixel color
     * @param {number} index - Pixel index
     * @returns {number} Pixel color value
     */
    getPixel(index) {
        if (index >= 0 && index < this.ledCount) {
            return this.pixels[index];
        }
        return 0;
    }

    /**
     * Helper method to run an animation as a Promise
     * @param {Function} animationFunc - Animation function
     * @param {number} color - Color value
     * @param {number} initialSpeed - Animation speed (ms)
     * @returns {Promise} Promise that resolves when animation completes
     */
    // In NeopixelController.js - _runAnimation method
    _runAnimation(animationFunc, color, initialSpeed) {
        logger.info(`Setting up animation function ${animationFunc.name}`);

        return new Promise((resolve) => {
            (async () => {
                try {
                    // Make sure running flag is true before starting
                    this.running = true;

                    // Explicitly create a controller reference object to pass to the animation
                    const controllerRef = {
                        running: true,  // This is key - create a new reference
                        render: (pixels) => this.renderWithBrightness(pixels),
                        speed: initialSpeed
                    };

                    // Set up a watcher that syncs the running flag
                    Object.defineProperty(controllerRef, 'running', {
                        get: () => this.running,
                        set: (value) => { this.running = value; }
                    });

                    // Add ability to update speed
                    Object.defineProperty(controllerRef, 'speed', {
                        get: () => this.currentSpeed,
                        set: (value) => { this.currentSpeed = value; }
                    });

                    this.currentSpeed = initialSpeed;

                    logger.info(`Starting animation function execution (running=${controllerRef.running})`);

                    // Pass the controller reference object instead of 'this'
                    const boundFunc = animationFunc.bind(this.animationManager);
                    await boundFunc(controllerRef, this.pixels, color);

                    logger.info(`Animation function completed normally`);
                } catch (error) {
                    logger.error(`Animation function error: ${error.message}`);
                } finally {
                    logger.info(`Animation function cleanup`);
                    this.running = false;
                    resolve();
                }
            })();
        });
    }

    /**
     * Stop the current animation
     */
    async stopAnimation() {
        // If the animation is running, stop it
        await this.forceStopAnimation();
    }

    /**
     * Clear all pixels
     */
    clear() {
        for (let i = 0; i < this.ledCount; i++) {
            this.pixels[i] = 0;
        }
        this.render(this.pixels);

        // Also stop any running animation
        this.stopAnimation();
    }

    /**
     * Render the current pixel array to the LED strip
     * @param {Uint32Array} pixels - Pixel array to render
     */
    render(pixels) {
        ws281x.render(pixels);
    }

    renderWithBrightness() {
        const pixelsWithBrightness = this.getPixelsWithBrightness();
        ws281x.render(pixelsWithBrightness);
    }

    /**
     * Set the number of pixels in the LED strip
     * @param {number} numPixels - New number of pixels
     */
    setNumPixels(numPixels) {
        // Stop any running animations
        this.stopAnimation();

        // Clear existing pixels
        this.clear();

        // Create a new pixel buffer with the new size
        this.ledCount = numPixels;
        this.pixels = new Uint32Array(numPixels);

        // Reconfigure the LED strip
        ws281x.configure({
            leds: numPixels,
            // Keep other settings the same
            brightness: this.brightness,
            stripType: StripType.WS2811_STRIP_GRB
        });

        logger.info(`Updated LED strip to ${numPixels} LEDs`);
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.stopAnimation();
        this.clear();
        ws281x.reset();
    }
}

export default NeopixelController;