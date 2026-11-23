const mqtt = require('mqtt');
const { logger } = require('../utils/logger');
const LED = require("../components/output/LED");
const WiFiManager = require('../wifi/WiFiManager');
const { ModuleSecretStore, defaultSecretFile } = require('./ModuleSecretStore');
const { ModuleSecretAuth, isConnackRefusal } = require('./ModuleSecretAuth');

const RECONNECT_PERIOD = 1000; // 1 second between reconnect attempts

/**
 * Enhanced MQTT Client for EGOS modules
 * Provides standardized device registration and messaging
 */
class MQTTClient {
    constructor(options = {}) {
        if (!options.clientId) {
            logger.warn('No clientId given: a random id is used, so the controller gives this module a new secret on every start. Pass a stable clientId.');
        }
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

        // Module secret (protocol v1, egos-cloud#1197): proves this module's
        // client id to the controller. Kept in its own file (option
        // `secretFile`, default ~/.egos/module-secret-<clientId>).
        this.secretAuth = new ModuleSecretAuth({
            clientId: this.clientId,
            store: new ModuleSecretStore({ filePath: options.secretFile || defaultSecretFile(this.clientId) }),
            logger,
            baseReconnectPeriod: RECONNECT_PERIOD
        });
        
        // Initialize WiFi Manager for credential updates
        this.wifiManager = new WiFiManager();
        
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
        const { username, password } = this.secretAuth.credentials();
        this.client = mqtt.connect(this.brokerUrl, {
            clientId: this.clientId,
            username,
            password,
            will: {
                topic: 'client/disconnect',
                payload: JSON.stringify({ id: this.clientId, status: 'disconnected' }),
                qos: 1,
                retain: false
            },
            keepalive: 2,  // Reduced from 30 for faster disconnect detection (~3s timeout)
            connectTimeout: 30000,  // 30 seconds
            reconnectPeriod: RECONNECT_PERIOD,
            // Keep reconnecting after a refused CONNACK (mqtt.js 5 stops by
            // default); the error handler below picks the credentials first
            reconnectOnConnackError: true
        });

        // Track client as resource
        this.resources.add(this.client);

        this.client.on('connect', () => {
            logger.info(`MQTT Connected! ${this.clientId}`);
            this.secretAuth.handleConnected(this.client.options);

            // Stop blinking and turn LED solid on when connected
            if (this.led) {
                this.led.stopBlink();
                this.led.turnOn();
            }

            // Add a small delay to ensure connection is fully established
            setTimeout(async () => {
                await this.registerDevices();
                this.onConnect?.(this.clientId);
            }, 50);
        });

        this.client.on('error', (error) => {
            logger.error('MQTT connection error:', error);
            // A refused CONNACK: mqtt.js reconnects after this handler, with
            // the username, password and period in client.options
            if (isConnackRefusal(error)) {
                this.secretAuth.handleConnackError(error.code, this.client.options);
            }
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
            // The module secret: handled before anything that could log or
            // pass on the payload
            if (topic === this.secretAuth.topic) {
                try {
                    this.secretAuth.handleSecretMessage(message, this.client.options);
                } catch (error) {
                    logger.error('Error handling the module secret message', { error: error.message });
                }
                return;
            }

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
                if (topic.endsWith('/configuration/set')) {
                    const deviceId = topic.split('/')[2];

                    logger.debug("Got configuration message:", { deviceId, payload });
                    this.onMessageReceived?.(topic, payload, deviceId);
                    this.configurationHandlers.get(deviceId)?.(payload);

                    return;
                }

                // Handle credentials/set messages
                if (topic.endsWith('/credentials/set')) {
                    logger.info("Received credentials/set message");
                    this.onMessageReceived?.(topic, payload);
                    this.handleCredentialsSet(payload);
                    return;
                }

                // Handle credentials/reset messages
                if (topic.endsWith('/credentials/reset')) {
                    logger.info("Received credentials/reset message");
                    this.onMessageReceived?.(topic, payload);
                    this.handleCredentialsReset();
                    return;
                }

                this.onMessageReceived?.(topic, payload);

                if(!topic)
                    return;

                const handler = this.messageHandlers.get(topic);
                if (handler) {
                    handler(payload);
                } else {
                    logger.warn(`Unable to find MQTT Message handler for topic: ${topic}`);
                }
            } catch (error) {
                logger.error('Error handling MQTT message:', error);
            }
        });
    }

    async registerDevices() {
        try {
            if (!this.client || !this.client.connected) {
                logger.warn('Client not connected when trying to register devices');
                return;
            }

            // Define all topics to subscribe to
            const subscriptionTopics = [
                `${this.clientId}/device/+/output`,
                `${this.clientId}/device/+/configuration/set`,
                `${this.clientId}/credentials/set`,
                `${this.clientId}/credentials/reset`,
                `${this.clientId}/controller/token`
            ];

            // The module secret topic is QoS 1 (protocol v1): the controller
            // answers module/register on it
            const qosByTopic = { [this.secretAuth.topic]: 1 };
            subscriptionTopics.push(this.secretAuth.topic);

            // Subscribe to all topics and wait for confirmation
            logger.info('Subscribing to all topics before registering...');
            const subscriptionPromises = subscriptionTopics.map(topic => {
                return new Promise((resolve, reject) => {
                    this.client.subscribe(topic, { qos: qosByTopic[topic] ?? 0 }, (error) => {
                        if (error) {
                            logger.error(`Failed to subscribe to ${topic}:`, error);
                            reject(error);
                        } else {
                            logger.info(`Successfully subscribed to ${topic}`);
                            resolve(topic);
                        }
                    });
                });
            });

            // Wait for all subscriptions to complete
            try {
                await Promise.all(subscriptionPromises);
                logger.info('All subscriptions confirmed, now registering devices...');
            } catch (subscriptionError) {
                logger.error('Some subscriptions failed, trying individual subscriptions:', subscriptionError);
                // Fallback to individual device subscriptions
                this.subscribeIndividually();
                await this.subscribeModuleSecret();
            }

            // Only publish module/register after all subscriptions are active
            this.client.publish('module/register', JSON.stringify(this.devices));
            logger.info(`Registered ${this.devices.length} devices`);
            
        } catch (error) {
            logger.error('Error registering devices:', error);
        }
    }

    /** Subscribes to `{id}/module/secret` at QoS 1; resolves either way. */
    subscribeModuleSecret() {
        return new Promise((resolve) => {
            this.client.subscribe(this.secretAuth.topic, { qos: 1 }, (error) => {
                if (error) {
                    logger.error(`Failed to subscribe to ${this.secretAuth.topic}:`, error);
                } else {
                    logger.info(`Successfully subscribed to ${this.secretAuth.topic}`);
                }
                resolve();
            });
        });
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

    /**
     * Handle credentials/set message from the controller
     * Updates WiFi credentials if SSID is different from current
     * @param {Object} payload - Message payload containing ssid and password
     */
    async handleCredentialsSet(payload) {
        try {
            const { ssid, password } = payload;

            // Validate payload
            if (!ssid || !password) {
                logger.error('Invalid credentials payload: missing ssid or password');
                return;
            }

            logger.info(`Processing credentials/set for SSID: ${ssid}`);

            // Update credentials (WiFiManager will check if SSID is different)
            const credentialsChanged = await this.wifiManager.updateCredentials(ssid, password);

            if (credentialsChanged) {
                logger.info('WiFi credentials changed, rebooting device...');
                
                // Publish acknowledgment before rebooting
                this.publish(`${this.clientId}/credentials/updated`, {
                    ssid: ssid,
                    status: 'success',
                    message: 'Credentials updated, rebooting...'
                });

                // Give time for the message to be sent before rebooting
                await this.wifiManager.rebootDevice(3000);
            } else {
                logger.info('SSID unchanged, no reboot needed');
                
                // Publish acknowledgment that no change was needed
                this.publish(`${this.clientId}/credentials/unchanged`, {
                    ssid: ssid,
                    status: 'unchanged',
                    message: 'SSID already configured'
                });
            }
        } catch (error) {
            logger.error('Error handling credentials/set:', error);
            
            // Publish error message
            this.publish(`${this.clientId}/credentials/error`, {
                status: 'error',
                message: error.message
            });
        }
    }

    /**
     * Handle credentials/reset message from the controller
     * Resets WiFi credentials to default (egos/egosegos) and reboots
     */
    async handleCredentialsReset() {
        try {
            logger.info('Processing credentials/reset to default');

            // Reset to default credentials
            const credentialsChanged = await this.wifiManager.resetToDefault();

            if (credentialsChanged) {
                logger.info('WiFi credentials reset to default, rebooting device...');
                
                // Publish acknowledgment before rebooting
                this.publish(`${this.clientId}/credentials/reset`, {
                    status: 'success',
                    message: 'Credentials reset to default, rebooting...'
                });

                // Give time for the message to be sent before rebooting
                await this.wifiManager.rebootDevice(3000);
            } else {
                logger.info('Already using default credentials, no reboot needed');
                
                // Publish acknowledgment that no change was needed
                this.publish(`${this.clientId}/credentials/unchanged`, {
                    status: 'unchanged',
                    message: 'Already using default credentials'
                });
            }
        } catch (error) {
            logger.error('Error handling credentials/reset:', error);
            
            // Publish error message
            this.publish(`${this.clientId}/credentials/error`, {
                status: 'error',
                message: error.message
            });
        }
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
