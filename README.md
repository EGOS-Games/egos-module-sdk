# EGOS Module SDK

A comprehensive SDK for building reliable hardware modules for the EGOS system.

## Features

### Input Components
- **BaseInput**: Foundation class with lifecycle management, error handling, and debouncing
- **SerialInput**: For QR scanners, barcode readers, and serial-based devices
- **PollingInput**: For RFID readers and other polling-based hardware

### Key Improvements
- **Resource Management**: Proper cleanup prevents memory leaks
- **Error Recovery**: Exponential backoff and automatic reconnection
- **Debouncing**: LRU cache-based duplicate prevention
- **Health Monitoring**: Built-in status tracking and reporting
- **Graceful Degradation**: System continues operating if components fail

## Installation

For local development:
```bash
npm link egos-module-sdk
```

For production:
```bash
npm install egos-module-sdk
```

## Usage

### Basic Serial Input (QR Reader)
```javascript
const { SerialInput } = require('egos-module-sdk');

const qrReader = new SerialInput({
    port: '/dev/ttyS0',
    baudRate: 115200,
    debounceTime: 1000,
    onCode: (code) => {
        console.log('QR Code:', code);
    }
});

await qrReader.start();
```

### Basic Polling Input (RFID Reader)
```javascript
const { PollingInput } = require('egos-module-sdk');

class RfidReader extends PollingInput {
    async readFromHardware() {
        // Implement your RFID read logic
        return await rfid.read();
    }
}

const rfidReader = new RfidReader({
    pollInterval: 200,
    debounceTime: 3000,
    onCode: (code) => {
        console.log('RFID Tag:', code);
    }
});

await rfidReader.start();
```

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Link for local development: `npm link`
4. In your module project: `npm link egos-module-sdk`

## Publishing

1. Update version in package.json
2. Run tests: `npm test`
3. Publish: `npm publish`

## License

MIT
