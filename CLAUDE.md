# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **EGOS Module SDK** - a comprehensive Node.js library for building reliable hardware modules for the EGOS (Enhanced Gaming Operating System) platform. The SDK provides standardized components for IoT device communication, MQTT messaging, input handling, and hardware abstraction.

## Key Architecture

### Core Components Structure
```
src/
├── components/
│   ├── input/           # Input handling abstractions
│   │   ├── BaseInput.js     # Foundation class with lifecycle management
│   │   └── PollingInput.js  # Async polling implementation
│   ├── output/          # Output control abstractions
│   │   └── LED.js           # LED control component
│   └── index.js         # Component exports
├── mqtt/
│   └── MQTTClient.js    # Enhanced MQTT client with device registration
├── utils/
│   └── logger.js        # Structured logging utilities
└── index.js             # Main SDK exports
```

### Design Patterns
- **Component-based Architecture**: Modular components with clear separation of concerns
- **Event-driven Communication**: EventEmitter-based components for loose coupling
- **Resource Management**: Automatic cleanup and lifecycle management
- **Error Recovery**: Exponential backoff and automatic reconnection strategies
- **Debouncing**: LRU cache-based duplicate prevention for hardware inputs

### Key Classes
- **BaseInput**: Foundation class for all input components with standardized error handling, debouncing, and health monitoring
- **MQTTClient**: Enhanced MQTT client with device registration, automatic subscriptions, and LED status indication
- **PollingInput**: Specialized input class for polling-based hardware (RFID readers, sensors)

## Development Commands

### Setup
```bash
npm install                    # Install dependencies
npm link                      # Link for local development (global)
npm link egos-module-sdk      # Link in consuming modules
```

### Local Development
```bash
# Use file path dependency (recommended)
# In consuming module's package.json:
"dependencies": {
  "egos-module-sdk": "file:../egos-module-sdk"
}
```

### Linting
```bash
npx eslint src/               # Run ESLint on source code
```

### Publishing
```bash
npm version patch             # Increment version
npm publish                   # Publish to npm registry
```

## Module Integration Patterns

### Typical Module Structure
```javascript
const { MQTTClient, BaseInput, logger } = require('egos-module-sdk');

class MyModule {
    constructor() {
        this.mqttClient = new MQTTClient({
            clientId: 'my-module-001',
            devices: [/* device configs */],
            ledPin: 18  // Optional status LED
        });
    }

    async start() {
        // Initialize components
    }

    cleanup() {
        this.mqttClient.cleanup();
    }
}
```

### Input Component Usage
```javascript
const { SerialInput, PollingInput } = require('egos-module-sdk');

// For serial devices (QR scanners, barcode readers)
const qrReader = new SerialInput({
    port: '/dev/ttyS0',
    baudRate: 115200,
    debounceTime: 1000,
    onCode: (code) => console.log('QR:', code)
});

// For polling devices (RFID readers)
class RfidReader extends PollingInput {
    async readFromHardware() {
        return await rfid.read();
    }
}
```

## MQTT Communication

### Topic Structure
- **Registration**: `module/register` - Device registration
- **Input Events**: `{moduleId}/device/{deviceId}/input` - Hardware input events
- **Output Commands**: `{moduleId}/device/{deviceId}/output` - Device control commands
- **State Updates**: `{moduleId}/device/{deviceId}/state` - Device status

### Message Flow
1. Module registers devices with broker on connection
2. Subscribes to output topics for device control
3. Publishes input events when hardware triggers
4. Handles output commands from EGOS system

## Error Handling Strategy

### Automatic Recovery Features
- **Exponential Backoff**: Reconnection delays increase progressively
- **Circuit Breaker**: Max error thresholds before restart attempts
- **Resource Cleanup**: Automatic cleanup of timers, connections, and hardware resources
- **Health Monitoring**: Periodic health checks with status reporting

### Logging Integration
Uses Winston-based structured logging with different levels:
- `logger.info()` - General operational information
- `logger.warn()` - Warning conditions
- `logger.error()` - Error conditions with stack traces
- `logger.debug()` - Detailed debugging information

## Hardware Abstraction

### GPIO Integration
- Uses `rpio` library for Raspberry Pi GPIO control
- LED components provide status indication
- Resource tracking prevents GPIO conflicts

### Serial Communication
- Built-in support for serial devices
- Configurable baud rates and port settings
- Automatic connection management and recovery

## Development Best Practices

### Component Development
- Extend `BaseInput` for new input types
- Implement proper cleanup in `cleanup()` methods
- Use resource tracking for automatic cleanup
- Follow event-driven patterns for loose coupling

### Testing Strategy
- Test with file path dependencies during development
- Use debug logging to trace component interactions
- Monitor MQTT traffic for message flow verification
- Test error recovery scenarios

### Module Deployment
- Modules are deployed to Raspberry Pi devices
- Use `npm link` or file dependencies for local development
- Publish to npm for production distribution
- Version management follows semantic versioning

## Node.js Version Requirements

- **Minimum**: Node.js 20.0.0
- **LRU Cache**: Uses version 7.18.3 for compatibility
- **Dependencies**: MQTT 5.x, Winston 3.x, rpio 2.x

## Important Notes

- All input components inherit debouncing and error recovery
- MQTT client handles automatic device registration
- LED status indication provides visual feedback
- Resource cleanup prevents memory leaks
- Components are designed for long-running operation on embedded systems