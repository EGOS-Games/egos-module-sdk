// Input components (core dependencies)
const BaseInput = require('./input/BaseInput');
const PollingInput = require('./input/PollingInput');

// Output components (core dependencies)
const LED = require('./output/LED');

// Components with optional dependencies - loaded conditionally
const components = {
    // Core components (always available)
    BaseInput,
    PollingInput,
    LED,
};

module.exports = components;
