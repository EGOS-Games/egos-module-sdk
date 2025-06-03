// Import all components
const components = require('./components');

// MQTT client
const MQTTClient = require('./mqtt/MQTTClient');

// Utilities
const { logger, createLogger } = require('./utils/logger');

// Export everything
module.exports = {
    // All components (destructured for easy access)
    ...components,
    
    // MQTT
    MQTTClient,
    
    // Utilities
    logger,
    createLogger,
    
    // Version info
    version: require('../package.json').version
};
