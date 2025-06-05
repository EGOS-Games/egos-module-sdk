const PollingInput = require('./PollingInput');
const rfid = require('node-rfid');

/**
 * RFID Reader implementation using EGOS Module SDK
 * Extends PollingInput to provide RFID-specific functionality
 */
class RfidReader extends PollingInput {
    constructor(options = {}) {
        super({
            debounceTime: options.debounceTime || 3000,
            pollInterval: options.pollInterval || 200,
            readTimeout: options.readTimeout || 3000,
            maxErrors: options.maxErrors || 3,
            reconnectDelay: options.reconnectDelay || 1000,
            ...options
        });

        // Don't auto-start in constructor
    }

    /**
     * Initialize RFID hardware
     */
    async initializeHardware() {
        // Test hardware connectivity
        try {
            await this.testHardware();
        } catch (error) {
            throw new Error('RFID hardware not accessible: ' + error.message);
        }
    }

    /**
     * Test RFID hardware connectivity
     */
    async testHardware() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('RFID hardware test timeout'));
            }, 2000);

            try {
                rfid.read((err, result) => {
                    clearTimeout(timeout);
                    // Any response (even "no tag") means hardware is working
                    resolve(result);
                });
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    /**
     * Read from RFID hardware
     */
    async readFromHardware() {
        return new Promise((resolve, reject) => {
            try {
                rfid.read((err, result) => {
                    if (err) {
                        // Filter specific error types
                        if (err.message && err.message.includes('E2')) {
                            reject(new Error('RFID communication error'));
                            return;
                        }
                        
                        if (err.message && err.message.includes('No tag found')) {
                            resolve(null); // Normal, not an error
                            return;
                        }
                        
                        reject(err);
                        return;
                    }

                    // Validate and clean result
                    if (result && typeof result === 'string' && result.trim()) {
                        const cleanResult = result.trim();
                        
                        // Filter invalid results
                        if (cleanResult.includes('E2') || cleanResult.length < 4) {
                            resolve(null);
                            return;
                        }
                        
                        resolve(cleanResult);
                    } else {
                        resolve(null);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Clean up RFID hardware resources
     */
    async cleanupHardware() {
        // RFID library doesn't have explicit cleanup
        // but we can add any necessary cleanup logic here
        try {
            // If the library had a close method:
            // await rfid.close();
        } catch (error) {
            // Ignore cleanup errors
        }
    }
}

module.exports = RfidReader;
