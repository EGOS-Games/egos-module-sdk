class AnimationManager {
    constructor() {
        this.animations = {
            'rainbow': this.rainbowCycle,
            'color_wipe': this.colorWipe,
            'theater_chase': this.theaterChase,
            'bounce': this.bounce,
            'fade': this.fade,
            'sparkle': this.sparkle,
            'fire': this.fireEffect,
            'wave': this.wave,
            'police_lights': this.policeLights,
            'scroll_left': this.scrollLeft,
            'scroll_right': this.scrollRight
        };
    }

    /**
     * Convert hex color to RGB object
     * @param {number} hexColor - Color in hex format (0xRRGGBB)
     * @returns {Object} RGB object with r, g, b properties
     */
    hexToRgb(hexColor) {
        const r = (hexColor >> 16) & 0xFF;
        const g = (hexColor >> 8) & 0xFF;
        const b = hexColor & 0xFF;
        return { r, g, b };
    }

    /**
     * Convert RGB to uint32 color value
     * @param {number} r - Red value (0-255)
     * @param {number} g - Green value (0-255)
     * @param {number} b - Blue value (0-255)
     * @returns {number} Color value as uint32
     */
    rgbToColor(r, g, b) {
        return (r << 16) | (g << 8) | b;
    }

    grbToColor(r, g, b) {
        return (g << 16) | (r << 8) | b;
    }

    /**
     * Generate rainbow colors across 0-255 positions
     * @param {number} pos - Position (0-255)
     * @returns {number} Color value
     */
    wheel(pos) {
        pos = pos % 256;

        if (pos < 85) {
            return this.rgbToColor(pos * 3, 255 - pos * 3, 0);
        } else if (pos < 170) {
            pos -= 85;
            return this.rgbToColor(255 - pos * 3, 0, pos * 3);
        } else {
            pos -= 170;
            return this.rgbToColor(0, pos * 3, 255 - pos * 3);
        }
    }

    /**
     * Wipe color across display a pixel at a time
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Color value
     */
    async colorWipe(controller, pixels, color) {
        const numPixels = pixels.length;

        while (controller.running) {
            // Turn on pixels one by one
            for (let i = 0; i < numPixels; i++) {
                if (!controller.running) return;

                pixels[i] = color;
                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));
            }

            // Turn off pixels one by one
            for (let i = 0; i < numPixels; i++) {
                if (!controller.running) return;

                pixels[i] = 0;
                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));
            }
        }
    }

    /**
     * Draw rainbow that uniformly distributes itself across all pixels and animates
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Unused in rainbow (keeps API consistent)
     */
    async rainbowCycle(controller, pixels, color) {
        const numPixels = pixels.length;
        let offset = 0;

        while (controller.running) {
            // Create shifting rainbow pattern
            for (let i = 0; i < numPixels; i++) {
                if (!controller.running) {
                    return;
                }

                // Multiply offset by 3 to make movement more noticeable
                // Add the offset to create movement, and wrap around with % 256
                const adjustedPos = (Math.floor(i * 256 / numPixels) + (offset * 3)) % 256;
                pixels[i] = this.wheel(adjustedPos);
            }

            controller.render(pixels);
            await new Promise(resolve => setTimeout(resolve, controller.speed));

            // Increment offset to move the pattern
            offset = (offset + 1) % 256;
        }
    }

    /**
     * Movie theater light style chaser animation
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Color value
     */
    async theaterChase(controller, pixels, color) {
        const numPixels = pixels.length;

        while (controller.running) {
            for (let q = 0; q < 3; q++) {
                if (!controller.running) return;

                // Turn every third pixel on
                for (let i = 0; i < numPixels; i += 3) {
                    if (i + q < numPixels) {
                        pixels[i + q] = color;
                    }
                }

                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));

                // Turn every third pixel off
                for (let i = 0; i < numPixels; i += 3) {
                    if (i + q < numPixels) {
                        pixels[i + q] = 0;
                    }
                }
            }
        }
    }

    /**
     * Light bouncing from end to end
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Color value
     */
    async bounce(controller, pixels, color) {
        const numPixels = pixels.length;

        while (controller.running) {
            // Bounce from left to right
            for (let i = 0; i < numPixels; i++) {
                if (!controller.running) return;

                pixels[i] = color;
                if (i > 0) {
                    pixels[i - 1] = 0;
                }

                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));
            }

            // Bounce from right to left
            for (let i = numPixels - 1; i >= 0; i--) {
                if (!controller.running) return;

                pixels[i] = color;
                if (i < numPixels - 1) {
                    pixels[i + 1] = 0;
                }

                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));
            }
        }
    }

    /**
     * Fade in and out with more consistent perceived speed and minimum brightness
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Color value
     */
    async fade(controller, pixels, color) {
        const numPixels = pixels.length;
        const rgb = this.hexToRgb(color);
        const steps = 100;
        const minBrightness = 0.05;  // 5% minimum brightness

        while (controller.running) {
            // Fade in
            for (let i = 0; i < steps; i++) {
                if (!controller.running) return;

                // Modified curve: start from minBrightness and use exponential scaling for low end
                const progress = i / steps;
                const brightness = minBrightness + (1 - minBrightness) * (progress * progress);

                const scaledColor = this.rgbToColor(
                    Math.floor(rgb.r * brightness),
                    Math.floor(rgb.g * brightness),
                    Math.floor(rgb.b * brightness)
                );

                for (let j = 0; j < numPixels; j++) {
                    pixels[j] = scaledColor;
                }

                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));
            }

            // Fade out
            for (let i = steps - 1; i >= 0; i--) {
                if (!controller.running) return;

                // Same curve for fade out
                const progress = i / steps;
                const brightness = minBrightness + (1 - minBrightness) * (progress * progress);

                const scaledColor = this.rgbToColor(
                    Math.floor(rgb.r * brightness),
                    Math.floor(rgb.g * brightness),
                    Math.floor(rgb.b * brightness)
                );

                for (let j = 0; j < numPixels; j++) {
                    pixels[j] = scaledColor;
                }

                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));
            }
        }
    }

    /**
     * Random pixels light up and fade
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Color value
     */
    async sparkle(controller, pixels, color) {
        const numPixels = pixels.length;

        while (controller.running) {
            if (!controller.running) return;

            const pixelIndex = Math.floor(Math.random() * numPixels);
            pixels[pixelIndex] = color;

            controller.render(pixels);
            await new Promise(resolve => setTimeout(resolve, controller.speed));

            pixels[pixelIndex] = 0;
        }
    }

    /**
     * Create a realistic fire-like effect across all pixels with gradual changes
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Unused in fire effect (keeps API consistent)
     */
    async fireEffect(controller, pixels, color) {
        const numPixels = pixels.length;
        const heat = new Array(numPixels).fill(0);

        while (controller.running) {
            // Step 1: More gentle cooling
            for (let i = 0; i < numPixels; i++) {
                // Reduced cooling range for more gradual changes
                const cooldown = Math.floor(Math.random() * 15);
                heat[i] = Math.max(0, heat[i] - cooldown);
            }

            // Step 2: More subtle heat diffusion
            for (let i = 0; i < numPixels; i++) {
                const prev = heat[(i - 1 + numPixels) % numPixels];
                const next = heat[(i + 1) % numPixels];
                // More gradual diffusion
                heat[i] = Math.floor((heat[i] * 2 + prev + next) / 5);
            }

            // Step 3: Fewer, more subtle sparks
            if (Math.random() * 100 < 30) {  // Only 30% chance of new sparks each frame
                for (let j = 0; j < Math.floor(numPixels / 16); j++) {  // Reduced number of sparks
                    const pos = Math.floor(Math.random() * numPixels);
                    // More subtle intensity changes
                    const intensity = 80 + Math.floor(Math.random() * 100);  // Range 80-180
                    heat[pos] = Math.min(255, heat[pos] + intensity);
                }
            }

            // Step 4: Convert heat to LED colors
            for (let i = 0; i < numPixels; i++) {
                if (!controller.running) return;

                const heatValue = Math.min(heat[i], 255);
                let red, green, blue;

                // More gradual color transitions
                if (heatValue < 85) {  // Cooler: more red
                    red = heatValue * 3;
                    green = Math.floor(heatValue / 4);  // Reduced green in cooler flames
                    blue = 0;
                } else if (heatValue < 170) {  // Medium: orange
                    red = 255;
                    green = heatValue - 85;  // More gradual green transition
                    blue = 0;
                } else {  // Hotter: yellow/white
                    red = 255;
                    green = 140 + Math.floor((heatValue - 170) / 3);  // More subtle yellows
                    blue = Math.floor((heatValue - 170) / 4);  // Reduced blue/white
                }

                pixels[i] = this.rgbToColor(Math.floor(green), Math.floor(red), Math.floor(blue));
            }

            controller.render(pixels);
            await new Promise(resolve => setTimeout(resolve, controller.speed * 2));  // Doubled the delay
        }
    }

    /**
     * Create a police light effect with multiple sets of red/blue patterns
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Unused in police lights (keeps API consistent)
     */
    async policeLights(controller, pixels, color) {
        const numPixels = pixels.length;
        const red = this.rgbToColor(0, 255, 0);
        const blue = this.rgbToColor(0, 0, 255);
        const white = this.rgbToColor(255, 255, 255);
        const off = 0;

        // Increased pattern length and number of sets
        const patternLength = Math.floor(numPixels / 6);  // Each color section takes up 1/6 of the strip
        const gapLength = Math.floor(patternLength / 4);  // Black gap between colors

        // Calculate how many complete sets we can fit
        const setLength = (patternLength * 2 + gapLength * 2);  // Length of a red-blue set with gaps
        const numSets = 2;  // Number of red-blue sets that will move together

        while (controller.running) {
            // Move patterns across the strip
            for (let startPos = -patternLength; startPos < numPixels; startPos++) {
                if (!controller.running) return;

                // Clear strip
                for (let i = 0; i < numPixels; i++) {
                    pixels[i] = off;
                }

                // Draw multiple sets of patterns
                for (let setNum = 0; setNum < numSets; setNum++) {
                    const setOffset = Math.floor(setNum * (numPixels / numSets));  // Space sets evenly around strip

                    // Set red pattern for this set
                    for (let i = 0; i < patternLength; i++) {
                        const pos = (startPos + i + setOffset) % numPixels;
                        if (pos >= 0 && pos < numPixels) {
                            pixels[pos] = red;
                        }
                    }

                    // Set blue pattern for this set (offset by patternLength + gap)
                    for (let i = 0; i < patternLength; i++) {
                        const pos = (startPos + i + patternLength + gapLength + setOffset) % numPixels;
                        if (pos >= 0 && pos < numPixels) {
                            pixels[pos] = blue;
                        }
                    }

                    // Add white flash every few cycles
                    if (startPos % 20 < 5) {
                        for (let i = 0; i < Math.floor(patternLength / 2); i++) {  // Shorter white sections
                            const pos = (startPos + i + (patternLength * 2) + gapLength * 2 + setOffset) % numPixels;
                            if (pos >= 0 && pos < numPixels) {
                                pixels[pos] = white;
                            }
                        }
                    }
                }

                controller.render(pixels);
                await new Promise(resolve => setTimeout(resolve, controller.speed));
            }
        }
    }

    /**
     * Create a sine wave effect
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Color value
     */
    async wave(controller, pixels, color) {
        const numPixels = pixels.length;
        const rgb = this.hexToRgb(color);
        let timestamp = Date.now() / 1000;  // Initial timestamp

        while (controller.running) {
            timestamp = Date.now() / 1000;  // Update time

            for (let i = 0; i < numPixels; i++) {
                if (!controller.running) return;

                // Create a wave pattern
                const intensity = (Math.sin(i / 2.0 + timestamp * 2.0) + 1.0) / 2.0;
                pixels[i] = this.rgbToColor(
                    Math.floor(rgb.r * intensity),
                    Math.floor(rgb.g * intensity),
                    Math.floor(rgb.b * intensity)
                );
            }

            controller.render(pixels);
            await new Promise(resolve => setTimeout(resolve, controller.speed));
        }
    }

    /**
     * Scroll all pixels to the left, wrapping around to the right side
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Used to initialize pixels if empty
     */
    async scrollLeft(controller, pixels, color) {
        const numPixels = pixels.length;

        // Initialize pixels if they're all zero
        let hasValues = false;
        for (let i = 0; i < numPixels; i++) {
            if (pixels[i] !== 0) {
                hasValues = true;
                break;
            }
        }

        if (!hasValues) {
            // Set up a pattern using the color
            for (let i = 0; i < numPixels; i++) {
                pixels[i] = (i % 3 === 0) ? color : 0;
            }
            controller.render(pixels);
        }

        while (controller.running) {
            // Store the first pixel's color for wrapping
            const firstPixel = pixels[0];

            // Shift all pixels left by one position
            for (let i = 0; i < numPixels - 1; i++) {
                if (!controller.running) return;
                pixels[i] = pixels[i + 1];
            }

            // Wrap the first pixel to the end
            pixels[numPixels - 1] = firstPixel;

            // Show the new pattern and wait
            controller.render(pixels);
            await new Promise(resolve => setTimeout(resolve, controller.speed));
        }
    }

    /**
     * Scroll all pixels to the right, wrapping around to the left side
     * @param {LEDController} controller - LED controller instance
     * @param {Uint32Array} pixels - Pixel array
     * @param {number} color - Used to initialize pixels if empty
     * @param {number} speed - Animation speed (ms)
     */
    async scrollRight(controller, pixels, color) {
        const numPixels = pixels.length;

        // Initialize pixels if they're all zero
        let hasValues = false;
        for (let i = 0; i < numPixels; i++) {
            if (pixels[i] !== 0) {
                hasValues = true;
                break;
            }
        }

        if (!hasValues) {
            // Set up a pattern using the color
            for (let i = 0; i < numPixels; i++) {
                pixels[i] = (i % 3 === 0) ? color : 0;
            }
            controller.render(pixels);
        }

        while (controller.running) {
            // Store the last pixel's color for wrapping
            const lastPixel = pixels[numPixels - 1];

            // Shift all pixels right by one position
            for (let i = numPixels - 1; i > 0; i--) {
                if (!controller.running) return;
                pixels[i] = pixels[i - 1];
            }

            // Wrap the last pixel to the start
            pixels[0] = lastPixel;

            // Show the new pattern and wait
            controller.render(pixels);
            await new Promise(resolve => setTimeout(resolve, controller.speed));
        }
    }

    /**
     * Get animation function by name
     * @param {string} name - Animation name
     * @returns {Function} Animation function or undefined if not found
     */
    getAnimation(name) {
        return this.animations[name];
    }
}

module.exports = AnimationManager;