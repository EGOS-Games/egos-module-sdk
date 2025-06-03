const BaseInput = require('./BaseInput');
const { logger } = require('../../utils/logger');

/**
 * Polling input component for devices that require active polling
 * Uses async/await instead of intervals to prevent resource buildup
 */
class PollingInput extends BaseInput {
    constructor(options = {}) {
        super(options);
        
        this.pollingOptions = {
            pollInterval: options.pollInterval || 200,
            readTimeout: options.readTimeout || 5000,
            maxConcurrentReads: 1,
            ...options.pollingOptions
        };

        this.isPolling = false;
        this.activeReads = 0;
        this.shouldPoll = false;
        this.pollPromise = null;
    }

    /**
     * Initialize polling mechanism
     */
    async initialize() {
        logger.info(`Initializing polling input with ${this.pollingOptions.pollInterval}ms interval`);
        
        // Initialize hardware-specific resources
        await this.initializeHardware();
        
        // Start polling
        this.shouldPoll = true;
        this.startPolling();
    }

    /**
     * Hardware-specific initialization (override in subclasses)
     */
    async initializeHardware() {
        // Override in subclasses
    }

    /**
     * Start the polling loop
     */
    startPolling() {
        if (this.isPolling) {
            return;
        }

        this.isPolling = true;
        this.pollPromise = this.pollLoop();
    }

    /**
     * Main polling loop using async/await to prevent resource buildup
     */
    async pollLoop() {
        while (this.shouldPoll && this.isActive) {
            try {
                // Check if we have too many concurrent reads
                if (this.activeReads >= this.pollingOptions.maxConcurrentReads) {
                    await this.sleep(this.pollingOptions.pollInterval);
                    continue;
                }

                // Perform read operation
                await this.performRead();
                
                // Wait between polls
                await this.sleep(this.pollingOptions.pollInterval);
                
            } catch (error) {
                logger.error('Error in polling loop:', error);
                this.handleError(error);
                
                // Back off on errors
                await this.sleep(this.pollingOptions.pollInterval * 2);
            }
        }
        
        this.isPolling = false;
        logger.info('Polling loop ended');
    }

    /**
     * Perform a single read operation (override in subclasses)
     */
    async performRead() {
        if (!this.shouldPoll || !this.isActive) {
            return;
        }

        this.activeReads++;

        try {
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error('Read operation timeout'));
                }, this.pollingOptions.readTimeout);
                this.addTimer(timer);
            });

            // Perform hardware read (implement in subclasses)
            const readPromise = this.readFromHardware();
            
            // Race between read and timeout
            const result = await Promise.race([readPromise, timeoutPromise]);
            
            if (result) {
                this.processCode(result);
            }
            
        } catch (error) {
            if (error.message !== 'Read operation timeout') {
                throw error;
            }
            logger.debug('Read operation timed out (normal for polling)');
        } finally {
            this.activeReads--;
        }
    }

    /**
     * Hardware-specific read implementation (override in subclasses)
     */
    async readFromHardware() {
        throw new Error('readFromHardware() must be implemented by subclass');
    }

    /**
     * Promise-based sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            this.addTimer(timer);
        });
    }

    /**
     * Stop polling
     */
    async stopPolling() {
        this.shouldPoll = false;
        
        if (this.pollPromise) {
            try {
                await this.pollPromise;
            } catch (error) {
                logger.warn('Error waiting for poll loop to end:', error);
            }
        }
        
        this.isPolling = false;
    }

    /**
     * Clean up polling resources
     */
    async cleanup() {
        logger.info('Cleaning up polling input...');
        
        // Stop polling
        await this.stopPolling();
        
        // Cleanup hardware-specific resources
        await this.cleanupHardware();
        
        // Call parent cleanup
        await super.cleanup();
    }

    /**
     * Hardware-specific cleanup (override in subclasses)
     */
    async cleanupHardware() {
        // Override in subclasses
    }

    /**
     * Get polling-specific status
     */
    getStatus() {
        const baseStatus = super.getStatus();
        return {
            ...baseStatus,
            isPolling: this.isPolling,
            activeReads: this.activeReads,
            pollInterval: this.pollingOptions.pollInterval
        };
    }
}

module.exports = PollingInput;
