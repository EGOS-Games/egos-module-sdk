const mqtt = require('mqtt');
const { logger } = require('../utils/logger');
const LED = require("../components/output/LED");

/**
 * Enhanced MQTT Client for EGOS modules
 * Provides standardized device registration and messaging
 */
class MQTTClient {
    constructor(options = {}) {
        this.clientId = options.clientId || `device-${Math.random().toString(16).slice(2, 10)}`;
        this.brokerUrl = options.brokerUrl || 'mqtt://egos.local:1883';
        this.devices = options.devices || [];
        this.ledPin = options.ledPin;
        this.messageHandlers = new Map();
        this.outputHandlers = new Map();
        this.configurationHandlers = new Map();
        this.onConnect = options.onConnect || (() => {});
        this.onMessageReceived = options.onMessageReceived || (() => {});
        this.onMessageSent = options.onMessageSent || (() => {});
        
        // Resource tracking for cleanup
        this.resources = new Set();
        this.timers = new Set();

        // Initialize LED if pin is provided
        if (this.ledPin) {
            this.led = new LED({ pin: this.ledPin });
            this.resources.add(this.led);
            // Start blinking to indicate connecting
            this.led.blink(500); // Blink every 500ms
        }

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
            logger.info(`MQTT Connected! ${this.clientId}`);

            // Stop blinking and turn LED solid on when connected
            if (this.led) {
                this.led.stopBlink();
                this.led.turnOn();
            }

            // Add a small delay to ensure connection is fully established
            setTimeout(() => {
                this.registerDevices();
                this.onConnect?.(this.clientId);
            }, 50);
        });

        this.client.on('error', (error) => {
            logger.error('MQTT connection error:', error);
            // Start blinking again on error
            if (this.led) {
                this.led.blink(200);
            }
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

            // Start blinking when connection is closed
            if (this.led) {
                this.led.blink(200);
            }
        });

        this.client.on('disconnect', () => {
            logger.warn('MQTT client disconnected', {
                clientId: this.clientId,
                warning: 'If this happens repeatedly, check for duplicate module instances'
            });

            // Start blinking when disconnected
            if (this.led) {
                this.led.blink(200);
            }
        });

        this.client.on('offline', () => {
            logger.warn('MQTT client offline');

            // Start blinking when offline
            if (this.led) {
                this.led.blink(200);
            }
        });

        this.client.on('reconnect', () => {
            logger.info('MQTT client attempting to reconnect');
            // Ensure LED is blinking during reconnection attempts
            if (this.led && !this.led.isBlinking) {
                this.led.blink(500);
            }
        });

        this.client.on('message', (topic, message) => {
            try {
                const payload = JSON.parse(message.toString());

                // Handle output messages
                if (topic.endsWith('/output')) {
                    const deviceId = topic.split('/')[2];

                    logger.debug("Got output message:", { deviceId, payload });
                    this.onMessageReceived?.(topic, payload, deviceId);
                    this.outputHandlers.get(deviceId)?.(payload);

                    return;
                }

                // Handle configuration messages
                if (topic.endsWith('/configuration')) {
                    const deviceId = topic.split('/')[2];

                    logger.debug("Got configuration message:", { deviceId, payload });
                    this.onMessageReceived?.(topic, payload, deviceId);
                    this.configurationHandlers.get(deviceId)?.(payload);

                    return;
                }
                this.onMessageReceived?.(topic, payload);

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
                    // Subscribe to output messages
                    this.client.subscribe(`${this.clientId}/device/+/output`, { qos: 0 }, (error) => {
                        if (error) {
                            logger.error('Failed to subscribe to device/output:', error);
                            // Try individual subscriptions instead of wildcard
                            this.subscribeIndividually();
                        } else {
                            logger.info(`Successfully subscribed to ${this.clientId}/device/+/output`);
                        }
                    });

                    // Subscribe to configuration messages
                    this.client.subscribe(`${this.clientId}/device/+/configuration`, { qos: 0 }, (error) => {
                        if (error) {
                            logger.error('Failed to subscribe to device/configuration:', error);
                            // Try individual subscriptions instead of wildcard
                            this.subscribeIndividually();
                        } else {
                            logger.info(`Successfully subscribed to ${this.clientId}/device/+/configuration`);
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
            // Subscribe to output messages
            const outputTopic = `${this.clientId}/device/${device.id}/output`;
            this.client.subscribe(outputTopic, { qos: 0 }, (error) => {
                if (error) {
                    logger.error(`Failed to subscribe to ${outputTopic}:`, error);
                } else {
                    logger.info(`Successfully subscribed to ${outputTopic}`);
                }
            });

            // Subscribe to configuration messages
            const configTopic = `${this.clientId}/device/${device.id}/configuration`;
            this.client.subscribe(configTopic, { qos: 0 }, (error) => {
                if (error) {
                    logger.error(`Failed to subscribe to ${configTopic}:`, error);
                } else {
                    logger.info(`Successfully subscribed to ${configTopic}`);
                }
            });
        });
    }

    onOutputMessage(deviceId, handler) {
        this.outputHandlers.set(deviceId, handler);
    }

    onConfigurationMessage(deviceId, handler) {
        this.configurationHandlers.set(deviceId, handler);
    }

    onMessage(topic, handler) {
        this.messageHandlers.set(topic, handler);
    }

    publishInputMessage(deviceId, message) {
        this.publish(`${this.clientId}/device/${deviceId}/input`, message, deviceId);
    }

    publishOutputErrorMessage(deviceId, message) {
        this.publish(`${this.clientId}/device/${deviceId}/output/error`, message, deviceId);
    }

    publishDeviceStateMessage(deviceId, state) {
        this.publish(
            `${this.clientId}/device/${deviceId}/state`, {
                moduleId: this.clientId,
                deviceId,
                state
            }, deviceId);
    }

    publish(topic, message, deviceId) {
        try {
            if (typeof message === 'object') {
                message = JSON.stringify(message);
            }
            this.onMessageSent?.(topic, message, deviceId);
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

            // Clean up LED
            if (this.led) {
                this.led.cleanup();
                logger.info('LED cleaned up successfully');
            }

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
