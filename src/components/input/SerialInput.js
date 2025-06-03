const BaseInput = require('./BaseInput');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { logger } = require('../../utils/logger');

/**
 * Serial input component for devices that communicate via serial port
 * Handles QR scanners, barcode readers, and other serial-based input devices
 */
class SerialInput extends BaseInput {
    constructor(options = {}) {
        super(options);
        
        this.serialOptions = {
            path: options.port || '/dev/ttyS0',
            baudRate: options.baudRate || 115200,
            dataBits: options.dataBits || 8,
            stopBits: options.stopBits || 1,
            parity: options.parity || 'none',
            delimiter: options.delimiter || '\r',
            includeDelimiter: false,
            ...options.serialOptions
        };

        this.port = null;
        this.parser = null;
    }

    /**
     * Initialize serial port connection
     */
    async initialize() {
        try {
            // Check if port is already open
            if (this.port && this.port.isOpen) {
                await this.closePort();
            }

            logger.info(`Opening serial port: ${this.serialOptions.path}`);
            
            this.port = new SerialPort({
                path: this.serialOptions.path,
                baudRate: this.serialOptions.baudRate,
                dataBits: this.serialOptions.dataBits,
                stopBits: this.serialOptions.stopBits,
                parity: this.serialOptions.parity
            });

            // Track port as resource for cleanup
            this.addResource(this.port);

            // Create parser
            this.parser = this.port.pipe(new ReadlineParser({
                delimiter: this.serialOptions.delimiter,
                includeDelimiter: this.serialOptions.includeDelimiter
            }));

            // Set up event handlers
            this.setupEventHandlers();

            // Wait for port to open
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Serial port open timeout'));
                }, 5000);

                this.port.once('open', () => {
                    clearTimeout(timeout);
                    logger.info(`Serial port opened: ${this.serialOptions.path}`);
                    resolve();
                });

                this.port.once('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        } catch (error) {
            logger.error('Failed to initialize serial port:', error);
            throw error;
        }
    }

    /**
     * Set up serial port event handlers
     */
    setupEventHandlers() {
        // Data from parser
        this.parser.on('data', (data) => {
            if (this.isActive && data) {
                logger.debug(`Serial data received: ${data}`);
                this.processCode(data);
            }
        });

        // Port events
        this.port.on('error', (error) => {
            logger.error('Serial port error:', error);
            this.handleError(error);
        });

        this.port.on('close', () => {
            logger.warn('Serial port closed unexpectedly');
            if (this.isActive && this.state === 'READY') {
                this.handleError(new Error('Serial port closed unexpectedly'));
            }
        });

        this.port.on('disconnect', () => {
            logger.warn('Serial port disconnected');
            if (this.isActive && this.state === 'READY') {
                this.handleError(new Error('Serial port disconnected'));
            }
        });
    }

    /**
     * Close serial port properly
     */
    async closePort() {
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port.close((error) => {
                    if (error) {
                        logger.warn('Error closing serial port:', error);
                    }
                    resolve();
                });
            });
        }
    }

    /**
     * Clean up serial resources
     */
    async cleanup() {
        logger.info('Cleaning up serial input...');
        
        // Close parser if it exists
        if (this.parser) {
            try {
                this.parser.removeAllListeners();
                this.parser = null;
            } catch (error) {
                logger.warn('Error cleaning up parser:', error);
            }
        }

        // Close port
        await this.closePort();
        this.port = null;

        // Call parent cleanup
        await super.cleanup();
    }

    /**
     * Get serial-specific status
     */
    getStatus() {
        const baseStatus = super.getStatus();
        return {
            ...baseStatus,
            portPath: this.serialOptions.path,
            isPortOpen: this.port ? this.port.isOpen : false,
            baudRate: this.serialOptions.baudRate
        };
    }
}

module.exports = SerialInput;
