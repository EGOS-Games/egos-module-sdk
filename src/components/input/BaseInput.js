const EventEmitter = require('events');
const { logger } = require('../../utils/logger');

/**
 * Base class for all input components providing:
 * - Standardized lifecycle management
 * - Resource cleanup
 * - Error handling with exponential backoff
 * - Health monitoring
 * - Debouncing capabilities
 */
class BaseInput extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            debounceTime: 3000,
            maxErrors: 3,
            reconnectDelay: 1000,
            maxReconnectDelay: 30000,
            backoffMultiplier: 2,
            healthCheckInterval: 30000,
            ...options
        };

        // State management
        this.state = 'INITIALIZING';
        this.isActive = false;
        this.errorCount = 0;
        this.reconnectDelay = this.options.reconnectDelay;
        
        // Resource tracking
        this.resources = new Set();
        this.timers = new Set();
        
        // Debouncing with LRU cache
        const { LRUCache } = require('lru-cache');
        this.recentCodes = new LRUCache({
            max: 100,
            ttl: this.options.debounceTime
        });

        // Callbacks
        this.onCode = options.onCode || (() => {});
        
        // Health monitoring
        this.lastActivity = Date.now();
        this.setupHealthMonitoring();
        
        logger.info(`${this.constructor.name} initialized with options:`, {
            debounceTime: this.options.debounceTime,
            maxErrors: this.options.maxErrors
        });
    }

    /**
     * Start the input component
     */
    async start() {
        if (this.isActive) {
            logger.warn(`${this.constructor.name} already active`);
            return;
        }

        try {
            this.state = 'STARTING';
            this.isActive = true;
            this.errorCount = 0;
            
            await this.initialize();
            
            this.state = 'READY';
            this.emit('ready');
            logger.info(`${this.constructor.name} started successfully`);
        } catch (error) {
            this.state = 'ERROR';
            this.handleError(error);
        }
    }

    /**
     * Stop the input component
     */
    async stop() {
        if (!this.isActive) {
            return;
        }

        logger.info(`${this.constructor.name} stopping...`);
        this.state = 'STOPPING';
        this.isActive = false;

        try {
            await this.cleanup();
            this.state = 'STOPPED';
            this.emit('stopped');
            logger.info(`${this.constructor.name} stopped successfully`);
        } catch (error) {
            logger.error(`Error during ${this.constructor.name} cleanup:`, error);
            this.state = 'ERROR';
        }
    }

    /**
     * Override in subclasses to implement specific initialization
     */
    async initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    /**
     * Process a code read from hardware
     */
    processCode(code) {
        if (!this.isActive || this.state !== 'READY') {
            return;
        }

        if (!code || typeof code !== 'string') {
            return;
        }

        const trimmedCode = code.trim();
        if (!trimmedCode) {
            return;
        }

        // Check debouncing
        if (this.recentCodes.has(trimmedCode)) {
            logger.debug(`Code debounced: ${trimmedCode}`);
            return;
        }

        // Record this code as recently seen
        this.recentCodes.set(trimmedCode, Date.now());
        
        // Update activity timestamp
        this.lastActivity = Date.now();
        
        // Process the code
        try {
            logger.info(`${this.constructor.name} code detected:`, { code: trimmedCode });
            this.onCode(trimmedCode);
            this.emit('code', trimmedCode);
        } catch (error) {
            logger.error(`Error in onCode callback:`, error);
        }
    }

    /**
     * Handle errors with exponential backoff
     */
    handleError(error) {
        this.errorCount++;
        logger.error(`${this.constructor.name} error (${this.errorCount}/${this.options.maxErrors}):`, error);

        if (this.errorCount >= this.options.maxErrors) {
            logger.warn(`${this.constructor.name} max errors reached, attempting restart...`);
            this.scheduleReconnect();
        }
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect() {
        if (!this.isActive) {
            return;
        }

        this.state = 'RECONNECTING';
        
        const timer = setTimeout(async () => {
            this.timers.delete(timer);
            
            if (!this.isActive) {
                return;
            }

            try {
                logger.info(`${this.constructor.name} attempting reconnection...`);
                await this.cleanup();
                await this.initialize();
                
                // Reset on successful reconnection
                this.errorCount = 0;
                this.reconnectDelay = this.options.reconnectDelay;
                this.state = 'READY';
                this.emit('reconnected');
                
                logger.info(`${this.constructor.name} reconnected successfully`);
            } catch (reconnectError) {
                logger.error(`${this.constructor.name} reconnection failed:`, reconnectError);
                
                // Increase delay for next attempt
                this.reconnectDelay = Math.min(
                    this.reconnectDelay * this.options.backoffMultiplier,
                    this.options.maxReconnectDelay
                );
                
                this.scheduleReconnect();
            }
        }, this.reconnectDelay);

        this.timers.add(timer);
        logger.info(`${this.constructor.name} reconnection scheduled in ${this.reconnectDelay}ms`);
    }

    /**
     * Set up health monitoring
     */
    setupHealthMonitoring() {
        const timer = setInterval(() => {
            if (!this.isActive) {
                return;
            }

            const timeSinceActivity = Date.now() - this.lastActivity;
            const isHealthy = timeSinceActivity < this.options.healthCheckInterval * 2;
            
            this.emit('health', {
                component: this.constructor.name,
                state: this.state,
                healthy: isHealthy,
                errorCount: this.errorCount,
                timeSinceActivity
            });

            if (!isHealthy && this.state === 'READY') {
                logger.warn(`${this.constructor.name} health check failed - no activity for ${timeSinceActivity}ms`);
            }
        }, this.options.healthCheckInterval);

        this.timers.add(timer);
    }

    /**
     * Register a resource for cleanup tracking
     */
    addResource(resource) {
        this.resources.add(resource);
    }

    /**
     * Register a timer for cleanup tracking
     */
    addTimer(timer) {
        this.timers.add(timer);
    }

    /**
     * Clean up all resources
     */
    async cleanup() {
        // Clear all timers
        for (const timer of this.timers) {
            clearTimeout(timer);
            clearInterval(timer);
        }
        this.timers.clear();

        // Clean up tracked resources
        for (const resource of this.resources) {
            try {
                if (resource && typeof resource.close === 'function') {
                    await resource.close();
                } else if (resource && typeof resource.cleanup === 'function') {
                    await resource.cleanup();
                } else if (resource && typeof resource.destroy === 'function') {
                    await resource.destroy();
                }
            } catch (error) {
                logger.error(`Error cleaning up resource:`, error);
            }
        }
        this.resources.clear();

        // Clear debounce cache
        this.recentCodes.clear();
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            state: this.state,
            isActive: this.isActive,
            errorCount: this.errorCount,
            lastActivity: this.lastActivity,
            reconnectDelay: this.reconnectDelay
        };
    }
}

module.exports = BaseInput;
