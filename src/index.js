// Core base classes
const BaseInput = require('./components/input/BaseInput');
const SerialInput = require('./components/input/SerialInput');
const PollingInput = require('./components/input/PollingInput');

// Specialized input components
const RfidInput = require('./components/input/RfidInput');
const QRInput = require('./components/input/QRInput');

// MQTT client
const MQTTClient = require('./mqtt/MQTTClient');

// Utilities
const { logger, createLogger } = require('./utils/logger');

// Export everything
module.exports = {
    // Base input components
    BaseInput,
    SerialInput,
    PollingInput,
    
    // Specialized components
    RfidInput,
    QRInput,
    
    // MQTT
    MQTTClient,
    
    // Utilities
    logger,
    createLogger,
    
    // Version info
    version: require('../package.json').version
};
