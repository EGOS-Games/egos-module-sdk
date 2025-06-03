const easymidi = require('easymidi');
const { logger } = require('../../utils/logger');

class MidiInput {
    constructor(options = {}) {
        this.onKeyOn = options.onKeyOn || (() => {});
        this.onKeyOff = options.onKeyOff || (() => {});
        this.onController = options.onController || (() => {});
        this.deviceName = options.deviceName || null;
        this.input = null;
        this.available = [];

        this.initialize();
    }

    initialize() {
        try {
            // Get list of available MIDI inputs
            this.available = easymidi.getInputs();
            logger.info('Available MIDI inputs:', this.available);

            if (this.available.length === 0) {
                logger.warn('No MIDI inputs available');
                return;
            }

            // If no specific device is specified, use the first one with 'USB' and then if none, the first available one
            const inputDevice = this.deviceName ?? this.available.find(device => device.includes('USB')) ?? this.available[0];

            if (!this.available.includes(inputDevice)) {
                logger.warn(`Specified MIDI device "${inputDevice}" not found. Available devices: ${this.available.join(', ')}`);
                return;
            }

            logger.info(`Connecting to MIDI input: ${inputDevice}`);
            this.input = new easymidi.Input(inputDevice);

            // Set up event handlers
            this.setupEventHandlers();

            logger.info('MIDI input initialized successfully');
        } catch (error) {
            logger.error('Error initializing MIDI input:', error);
            throw error;
        }
    }

    setupEventHandlers() {
        if (!this.input) {
            logger.warn('Cannot set up event handlers: No MIDI input available');
            return;
        }

        // Note on event (key press)
        this.input.on('noteon', msg => {
            logger.info('MIDI note on:', msg);
            this.onKeyOn({
                command: 'keyon',
                key: msg.note,
                velocity: msg.velocity,
                channel: msg.channel
            });
        });

        // Note off event (key release)
        this.input.on('noteoff', msg => {
            logger.info('MIDI note off:', msg);
            this.onKeyOff({
                command: 'keyoff',
                key: msg.note,
                velocity: msg.velocity || 0,
                channel: msg.channel
            });
        });

        // Controller events (knobs, sliders, etc.)
        this.input.on('cc', msg => {
            logger.info('MIDI controller:', msg);
            this.onController({
                command: 'controller',
                controller: msg.controller,
                value: msg.value,
                channel: msg.channel
            });
        });
    }

    getStatus() {
        return {
            available: this.available,
            connected: !!this.input,
            deviceName: this.input ? this.input.name : null
        };
    }

    getDevices() {
        // Refresh available devices list
        this.available = easymidi.getInputs();
        return this.available;
    }

    reconnect(deviceName = null) {
        this.cleanup();

        if (deviceName) {
            this.deviceName = deviceName;
        }

        this.initialize();
    }

    cleanup() {
        try {
            if (this.input) {
                this.input.close();
                this.input = null;
                logger.info('MIDI input closed successfully');
            }
        } catch (error) {
            logger.error('Error during MIDI cleanup:', error);
            throw error;
        }
    }
}

module.exports = MidiInput;
