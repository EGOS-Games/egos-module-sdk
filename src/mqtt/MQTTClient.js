const mqtt = require('mqtt');
const { logger } = require('../utils/logger');

/**
 * Enhanced MQTT Client for EGOS modules
 * Provides standardized device registration and messaging
 */
class MQTTClient {
    constructor(options = {}) {
        this.clientId = options.clientId || `device-${Math.random().toString(16).slice(2, 10)}`;
        this.brokerUrl = options.brokerUrl || 'mqtt://egos.local:1883';
        this.devices = options.devices || [];
        this.messageHandlers = new Map();
        this.outputHandlers = new Map();
        this.onConnect = options.onConnect || (() => {});
        
        // Resource tracking for cleanup
        this.resources = new Set();
        this.timers = new Set();

        this.connect();
    }

    connect() {
        this.client = mqtt.connect(this.brokerUrl, {
            clientId: this.clientId,
            will: {
                topic: 'client/disconnect',
                payload: JSON.stringify({ id: this.clientId, status: 'disconnected' }),
                qos: 1,
                retain: false
            },
            keepalive: 30,  // Match broker expectation
            connectTimeout: 30000,  // 30 seconds
            reconnectPeriod: 1000   // 1 second between reconnect attempts
        });

        // Track client as resource
        this.resources.add(this.client);

        this.client.on('connect', () => {
            logger.info(`MQTT Connected: ${this.clientId}`);
            // Add a small delay to ensure connection is fully established
            setTimeout(() => {
                this.registerDevices();
                this.onConnect?.(this.clientId);
            }, 50);
        });

        this.client.on('error', (error) => {
            logger.error('MQTT connection error:', error);
        });

        this.client.on('close', () => {
            logger.warn('MQTT connection closed', {
                clientId: this.clientId,
                possibleCauses: [
                    'Network connectivity issue',
                    'Broker restart',
                    'Duplicate client ID (another instance of this module started)',
                    'Keepalive timeout'
                ],
                advice: 'Check for multiple instances of this module running with the same client ID'
            });
        });

        this.client.on('disconnect', () => {
            logger.warn('MQTT client disconnected', {
                clientId: this.clientId,
                warning: 'If this happens repeatedly, check for duplicate module instances'
            });
        });

        this.client.on('offline', () => {
            logger.warn('MQTT client offline');
        });

        this.client.on('message', (topic, message) => {
            try {
                const payload = JSON.parse(message.toString());

                // Handle output messages
                if (topic.endsWith('/output')) {
                    const deviceId = topic.split('/')[2];
                    logger.debug("Got output message:", { deviceId, payload });
                    this.outputHandlers.get(deviceId)?.(payload);
                    return;
                }
                
                const handler = this.messageHandlers.get(topic);
                if (handler) {
                    handler(payload);
                } else {
                    logger.warn('Unable to find MQTT Message handler for topic:', topic);
                }
            } catch (error) {
                logger.error('Error handling MQTT message:', error);
            }
        });
    }

    registerDevices() {
        try {
            this.client.publish('module/register', JSON.stringify(this.devices));
            
            // Add a small delay before subscribing to prevent connection issues
            setTimeout(() => {
                if (this.client && this.client.connected) {
                    this.client.subscribe(`${this.clientId}/device/+/output`, { qos: 0 }, (error) => {
                        if (error) {
                            logger.error('Failed to subscribe to device/output:', error);
                            // Try individual subscriptions instead of wildcard
                            this.subscribeIndividually();
                        } else {
                            logger.info(`Successfully subscribed to ${this.clientId}/device/+/output`);
                        }
                    });
                } else {
                    logger.warn('Client not connected when trying to subscribe');
                }
            }, 100);
            
            logger.info(`Registered ${this.devices.length} devices`);
        } catch (error) {
            logger.error('Error registering devices:', error);
        }
    }

    subscribeIndividually() {
        // Fallback: subscribe to each device individually instead of using wildcard
        this.devices.forEach(device => {
            const topic = `${this.clientId}/device/${device.id}/output`;
            this.client.subscribe(topic, { qos: 0 }, (error) => {
                if (error) {
                    logger.error(`Failed to subscribe to ${topic}:`, error);
                } else {
                    logger.info(`Successfully subscribed to ${topic}`);
                }
            });
        });
    }

    onOutputMessage(deviceId, handler) {
        this.outputHandlers.set(deviceId, handler);
    }

    onMessage(topic, handler) {
        this.messageHandlers.set(topic, handler);
    }

    publishInputMessage(deviceId, message) {
        this.publish(`${this.clientId}/device/${deviceId}/input`, message);
    }

    publishOutputErrorMessage(deviceId, message) {
        this.publish(`${this.clientId}/device/${deviceId}/output/error`, message);
    }

    publishDeviceStateMessage(deviceId, state) {
        this.publish(
            `${this.clientId}/device/${deviceId}/state`, {
                moduleId: this.clientId,
                deviceId,
                state
            });
    }

    publish(topic, message) {
        try {
            if (typeof message === 'object') {
                message = JSON.stringify(message);
            }
            this.client.publish(topic, message);
        } catch (error) {
            logger.error('Error publishing message:', error);
        }
    }

    cleanup() {
        try {
            // Clear all timers
            for (const timer of this.timers) {
                clearTimeout(timer);
                clearInterval(timer);
            }
            this.timers.clear();

            // Clean up MQTT client
            if (this.client) {
                this.client.end(true);
                logger.info('MQTT client cleaned up successfully');
            }

            // Clear all resources
            this.resources.clear();
        } catch (error) {
            logger.error('Error during MQTT cleanup:', error);
        }
    }

    addTimer(timer) {
        this.timers.add(timer);
    }

    addResource(resource) {
        this.resources.add(resource);
    }
}

module.exports = MQTTClient;
