const SerialInput = require('./SerialInput');

/**
 * QR Reader implementation using EGOS Module SDK
 * Extends SerialInput to provide QR-specific functionality
 */
class QRInput extends SerialInput {
    constructor(options = {}) {
        super({
            debounceTime: options.debounceTime || 1000,
            maxErrors: options.maxErrors || 3,
            reconnectDelay: options.reconnectDelay || 2000,
            port: options.port || '/dev/ttyS0',
            baudRate: options.baudRate || 115200,
            delimiter: options.delimiter || '\r',
            serialOptions: {
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                ...options.serialOptions
            },
            ...options
        });

        super.initialize();
    }
}

module.exports = QRInput;
