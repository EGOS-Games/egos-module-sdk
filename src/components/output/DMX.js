const DMX = require("dmx");

class DMXController {
    /**
     * Creates a new DMX controller instance
     * @param {Object} config Configuration object
     * @param {string} config.port Serial port (e.g., 'COM3')
     * @param {string} config.driver Driver name (e.g., 'enttec-open-usb-dmx')
     * @param {string} config.universe Universe name (default: 'default')
     * @param {number} config.channels Total number of DMX channels (default: 512)
     */
    constructor(config = {}) {
        this.dmx = new DMX();
        this.config = {
            port: config.port || (process.platform === 'win32' ? 'COM3' : '/dev/ttyUSB0'),
            driver: config.driver || 'enttec-open-usb-dmx',
            universe: config.universe || 'default',
            channels: config.channels || 512
        };

        // Initialize state tracking
        this._state = new Array(this.config.channels).fill(0);

        // Initialize the DMX universe
        this.universe = this.dmx.addUniverse(
            this.config.universe,
            this.config.driver,
            this.config.port
        );

        // Reset all channels to 0
        this.blackout();
    }

    /**
     * Set values for multiple channels starting at a specific address
     * @param {number} startAddress Starting DMX address (1-512)
     * @param {Object} channelValues Object with relative channel numbers as keys and values (0-255)
     */
    setDeviceChannelValues(startAddress, channelValues) {
        // Validate start address
        if (startAddress < 1 || startAddress > this.config.channels) {
            throw new Error(`Invalid start address: ${startAddress}. Must be between 1 and ${this.config.channels}`);
        }

        // Convert the channel values to absolute addresses
        const absoluteChannels = {};
        for (const [relativeChannel, value] of Object.entries(channelValues)) {
            const absoluteChannel = startAddress + parseInt(relativeChannel) - 1;

            // Validate the calculated absolute channel
            if (absoluteChannel > this.config.channels) {
                throw new Error(`Channel ${absoluteChannel} exceeds maximum channel count of ${this.config.channels}`);
            }

            // Validate the value
            if (value < 0 || value > 255) {
                throw new Error(`Invalid value ${value} for channel ${absoluteChannel}. Must be between 0 and 255`);
            }

            absoluteChannels[absoluteChannel] = value;

            // Update state tracking (convert to 0-based index)
            this._state[absoluteChannel - 1] = value;
        }

        // Update the universe with the new values
        this.universe.update(absoluteChannels);
    }

    /**
     * Set RGB values for a device starting at a specific address
     * @param {number} startAddress Starting DMX address
     * @param {number} r Red value (0-255)
     * @param {number} g Green value (0-255)
     * @param {number} b Blue value (0-255)
     */
    setColor(startAddress, r, g, b) {
        this.setDeviceChannelValues(startAddress, {
            0: r,  // Red channel (relative to start address)
            1: g,  // Green channel (relative to start address)
            2: b   // Blue channel (relative to start address)
        });
    }

    /**
     * Set a single channel value
     * @param {number} channel DMX channel (1-512)
     * @param {number} value Channel value (0-255)
     */
    setChannel(channel, value) {
        this.setDeviceChannelValues(channel, { 0: value });
    }

    /**
     * Set all channels to a specific value
     * @param {number} value Value to set (0-255)
     */
    setAllChannels(value) {
        const channels = {};
        for (let i = 1; i <= this.config.channels; i++) {
            channels[i] = value;
            this._state[i - 1] = value;
        }
        this.universe.update(channels);
    }

    /**
     * Set all channels to 0
     */
    blackout() {
        this.setAllChannels(0);
    }

    getState() {
        const state = {};
        for (let i = 0; i < this.config.channels; i++) {
            if (this._state[i] > 0) {  // Only include non-zero values
                state[i + 1] = this._state[i];  // Convert to 1-based channel numbers
            }
        }
        return state;
    }

    /**
     * Get the current value of a specific channel
     * @param {number} channel DMX channel (1-512)
     * @returns {number} Current value of the channel (0-255)
     */
    getChannel(channel) {
        if (channel < 1 || channel > this.config.channels) {
            throw new Error(`Invalid channel: ${channel}. Must be between 1 and ${this.config.channels}`);
        }
        return this._state[channel - 1];
    }

    /**
     * Close the DMX controller and clean up resources
     */
    close() {
        // Add any necessary cleanup code here
        this.blackout();
    }
}

module.exports = {
    DMXController
};