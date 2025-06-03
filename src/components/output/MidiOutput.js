const easymidi = require('easymidi');
const { logger } = require('../../utils/logger');

class MidiOutput {
    constructor(options = {}) {
        this.deviceName = options.deviceName || null;
        this.output = null;
        this.available = [];
        this.state = {
            note: null,
            velocity: 0,
            channel: 0
        };

        this.initialize();
    }

    initialize() {
        try {
            // Get list of available MIDI outputs
            this.available = easymidi.getOutputs();
            logger.info('Available MIDI outputs:', this.available);

            if (this.available.length === 0) {
                logger.warn('No MIDI outputs available');
                return;
            }

            // If no specific device is specified, use the first available one
            const outputDevice = this.deviceName ?? this.available.find(device => device.includes('USB')) ?? this.available[0];

            if (!this.available.includes(outputDevice)) {
                logger.warn(`Specified MIDI device "${outputDevice}" not found. Available devices: ${this.available.join(', ')}`);
                return;
            }

            logger.info(`Connecting to MIDI output: ${outputDevice}`);
            this.output = new easymidi.Output(outputDevice);

            logger.info('MIDI output initialized successfully');
        } catch (error) {
            logger.error('Error initializing MIDI output:', error);
            throw error;
        }
    }

    sendNoteOn(note, velocity = 127, channel = 0) {
        if (!this.output) {
            logger.warn('Cannot send note on: No MIDI output available');
            return false;
        }

        try {
            this.output.send('noteon', {
                note: note,
                velocity: velocity,
                channel: channel
            });

            this.state = { note, velocity, channel };

            logger.info('Sent MIDI note on:', { note, velocity, channel });
            return true;
        } catch (error) {
            logger.error('Error sending MIDI note on:', error);
            return false;
        }
    }

    sendNoteOff(note, velocity = 0, channel = 0) {
        if (!this.output) {
            logger.warn('Cannot send note off: No MIDI output available');
            return false;
        }

        try {
            this.output.send('noteoff', {
                note,
                velocity,
                channel
            });

            if(this.state.note === note && this.state.channel === channel) {
                this.state = { note: null, velocity: 0, channel: 0 };
            }

            logger.info('Sent MIDI note off:', { note, velocity, channel });
            return true;
        } catch (error) {
            logger.error('Error sending MIDI note off:', error);
            return false;
        }
    }

    sendControlChange(controller, value, channel = 0) {
        if (!this.output) {
            logger.warn('Cannot send control change: No MIDI output available');
            return false;
        }

        try {
            this.output.send('cc', {
                controller: controller,
                value: value,
                channel: channel
            });

            this.state = { controller, value, channel };
            logger.debug('Sent MIDI control change:', { controller, value, channel });
            return true;
        } catch (error) {
            logger.error('Error sending MIDI control change:', error);
            return false;
        }
    }

    sendProgramChange(program, channel = 0) {
        if (!this.output) {
            logger.warn('Cannot send program change: No MIDI output available');
            return false;
        }

        try {
            this.output.send('program', {
                number: program,
                channel: channel
            });

            this.state = { program, channel };
            logger.debug('Sent MIDI program change:', { program, channel });
            return true;
        } catch (error) {
            logger.error('Error sending MIDI program change:', error);
            return false;
        }
    }

    // Generic method to send any type of MIDI message
    send(type, data) {
        if (!this.output) {
            logger.warn(`Cannot send ${type}: No MIDI output available`);
            return false;
        }

        try {
            this.output.send(type, data);
            logger.debug(`Sent MIDI ${type}:`, data);
            return true;
        } catch (error) {
            logger.error(`Error sending MIDI ${type}:`, error);
            return false;
        }
    }

    getStatus() {
        return {
            available: this.available,
            connected: !!this.output,
            deviceName: this.output ? this.output.name : null,
            ...this.state
        };
    }

    getDevices() {
        // Refresh available devices list
        this.available = easymidi.getOutputs();
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
            if (this.output) {
                // Turn off any notes that might be playing
                for (let channel = 0; channel < 16; channel++) {
                    for (let note = 0; note < 128; note++) {
                        this.sendNoteOff(note, 0, channel);
                    }
                }

                this.output.close();
                this.output = null;
                logger.info('MIDI output closed successfully');
            }
        } catch (error) {
            logger.error('Error during MIDI output cleanup:', error);
            throw error;
        }
    }
}

module.exports = MidiOutput;