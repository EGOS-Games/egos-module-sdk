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

## Module secret

`MQTTClient` proves its client id to the venue controller with a secret the controller gives it the first time it registers ("module secrets, protocol v1", egos-cloud#1197; the controller side is described in egos-controller `docs/LOCAL-AUTH.md`).

- It connects with username `module`. Without a stored secret the password is empty; it subscribes to `{clientId}/module/secret` (QoS 1) before `module/register`, and stores the secret the controller sends. The secret is used from the next connection. A secret message on a connection that already uses a secret is ignored. The wiring is in `src/mqtt/connectModuleClient.js`; it needs mqtt.js 5.16 or later and sets `reconnectOnConnackError`.
- The secret is kept in its own file, readable only by the module's user (mode 0600): the `secretFile` option, by default `~/.egos/module-secret-<clientId>`. It is never logged.
- If the controller refuses the secret (CONNACK 4, someone pressed **Forget**), the file is deleted and the module connects without one, getting a new secret.
- If the controller refuses an empty password (CONNACK 5), the id already has a secret this module lost (a reinstall, a deleted file). The module keeps retrying with backoff and logs a message: press **Forget** for the module in the controller's Settings > Paired devices.
- Always pass a stable `clientId` (for example one built from the MAC address). Without one a random id is used, so the module would get a new secret, and a new identity, on every start.

```javascript
const client = new MQTTClient({
    clientId: 'audio-a1b2c3',
    brokerUrl: 'mqtt://egos.local:1883',
    secretFile: '/var/lib/egos/module-secret',   // optional
    devices
});
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
