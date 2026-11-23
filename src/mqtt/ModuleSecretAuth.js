const { isValidSecret } = require('./ModuleSecretStore');

/** The MQTT username of a module that supports secrets (protocol v1). */
const MODULE_USERNAME = 'module';

/** The secret message's protocol version. */
const SECRET_VERSION = 1;

/** CONNACK return codes (MQTT 3.1.1), with their MQTT 5 reason codes. */
const CONNACK_BAD_USERNAME_OR_PASSWORD = 4;
const CONNACK_NOT_AUTHORIZED = 5;
const MQTT5_REASON_TO_RETURN_CODE = { 134: CONNACK_BAD_USERNAME_OR_PASSWORD, 135: CONNACK_NOT_AUTHORIZED };

const DEFAULT_MAX_RECONNECT_PERIOD = 60000;

/**
 * The secret in a `{id}/module/secret` payload, or null when the payload is
 * not `{ "secret": "<43 chars base64url>", "version": 1 }`.
 */
function parseSecretMessage(message) {
    let payload;
    try {
        payload = JSON.parse(Buffer.isBuffer(message) ? message.toString('utf8') : String(message));
    } catch (error) {
        // The parse error quotes the payload, so it is never logged
        return null;
    }
    if (!payload || typeof payload !== 'object') return null;
    if (payload.version !== SECRET_VERSION) return null;
    return isValidSecret(payload.secret) ? payload.secret : null;
}

/**
 * Whether an mqtt.js 'error' is a refused CONNACK. mqtt.js 5 emits those as
 * `Connection refused: ...` with the return code (reason code in MQTT 5) as
 * a numeric `code`; publish acknowledgement errors also have numeric codes.
 */
function isConnackRefusal(error) {
    return !!error && typeof error.code === 'number' &&
        typeof error.message === 'string' && error.message.startsWith('Connection refused');
}

/** MQTT 3.1.1 return code for a CONNACK refusal (maps MQTT 5 reason codes). */
function connackReturnCode(code) {
    return MQTT5_REASON_TO_RETURN_CODE[code] ?? code;
}

/**
 * What to do about a refused connection.
 * - `clear-secret`: CONNACK 4 while using a stored secret. The controller no
 *   longer knows it (someone pressed Forget): delete it and connect without.
 * - `secret-required`: CONNACK 5 with an empty password. The id has a secret
 *   this module doesn't hold: retry with backoff until someone presses Forget.
 * - `refused`: any other refusal: retry with backoff.
 */
function refusalAction(code, usingSecret) {
    const returnCode = connackReturnCode(code);
    if (returnCode === CONNACK_BAD_USERNAME_OR_PASSWORD && usingSecret) return 'clear-secret';
    if (returnCode === CONNACK_NOT_AUTHORIZED && !usingSecret) return 'secret-required';
    return 'refused';
}

/** The next reconnect period after a refusal: doubled, up to max. */
function nextReconnectPeriod(current, base, max) {
    const from = Math.max(current || base, base);
    return Math.min(from * 2, max);
}

/**
 * The module side of "module secrets, protocol v1" (egos-cloud#1197). It
 * chooses the connect credentials, stores the secret the controller sends on
 * `{id}/module/secret`, and reacts to CONNACK 4 and 5. It works on the mqtt.js
 * client's options object, which mqtt.js reads again on every reconnect.
 *
 * Never logs the secret, not even part of it.
 */
class ModuleSecretAuth {
    constructor({ clientId, store, logger, baseReconnectPeriod, maxReconnectPeriod = DEFAULT_MAX_RECONNECT_PERIOD }) {
        this.clientId = clientId;
        this.store = store;
        this.logger = logger;
        this.baseReconnectPeriod = baseReconnectPeriod;
        this.maxReconnectPeriod = maxReconnectPeriod;
        // Why the last credentials() call couldn't read the store, or null
        this.storeReadError = null;
    }

    /** The secret file, for log messages (the path, never the content). */
    get storeName() {
        return this.store.filePath || 'the module secret store';
    }

    /** The topic the controller sends this module's secret on. */
    get topic() {
        return `${this.clientId}/module/secret`;
    }

    /** Username `module`, and the stored secret or an empty password. */
    credentials() {
        let secret = null;
        try {
            secret = this.store.load();
            this.storeReadError = null;
        } catch (error) {
            this.storeReadError = error.code || error.message;
            this.logger.error(
                `Could not read the module secret from ${this.storeName} (${this.storeReadError}); connecting without one. ` +
                'If this module already has a secret, the controller will refuse it: fix the file\'s permissions or ownership ' +
                'for the user running the module, rather than pressing "Forget" in the controller.',
                { error: error.message }
            );
        }
        return { username: MODULE_USERNAME, password: secret || '' };
    }

    /**
     * Handles a message on `{id}/module/secret`: stores the secret and uses it
     * from the next connection (this one stays as it is). Returns true when a
     * secret was taken.
     */
    handleSecretMessage(message, options) {
        // The controller issues a secret only to a connection without one, so
        // a secret message on a connection that already uses a secret is not
        // from the controller's protocol: never let it replace a working one
        if (options.password !== '' && options.password !== undefined && options.password !== null) {
            this.logger.warn('Ignored a module secret message: this connection already uses a secret');
            return false;
        }
        const secret = parseSecretMessage(message);
        if (!secret) {
            this.logger.warn('Ignored an invalid module secret message');
            return false;
        }
        try {
            this.store.save(secret);
            this.logger.info('Module secret stored');
        } catch (error) {
            // Still use it until the module restarts; after that the controller
            // refuses the id until someone presses Forget
            this.logger.error('Could not store the module secret; it is kept only until the module restarts', { error: error.message });
        }
        options.password = secret;
        return true;
    }

    /**
     * Handles a refused connection (the error mqtt.js emits for a CONNACK
     * refusal has the return code as `code`). Updates the options mqtt.js
     * reconnects with. Returns the action taken.
     */
    handleConnackError(code, options) {
        const usingSecret = typeof options.password === 'string' ? options.password !== '' : !!options.password;
        const action = refusalAction(code, usingSecret);
        if (action === 'clear-secret') {
            try {
                this.store.clear();
                this.logger.warn('The controller no longer knows this module secret (CONNACK 4); secret cleared, connecting without one', { clientId: this.clientId });
            } catch (error) {
                this.logger.error('Could not delete the module secret file; connecting without it', { error: error.message });
            }
            options.username = MODULE_USERNAME;
            options.password = '';
            options.reconnectPeriod = this.baseReconnectPeriod;
            return action;
        }
        options.reconnectPeriod = nextReconnectPeriod(options.reconnectPeriod, this.baseReconnectPeriod, this.maxReconnectPeriod);
        if (action === 'secret-required' && this.storeReadError) {
            this.logger.warn(
                `The controller refused module id "${this.clientId}" (CONNACK 5): it has a secret for this module, but ` +
                `${this.storeName} could not be read (${this.storeReadError}). Fix the file's permissions or ownership; ` +
                'pressing "Forget" would also work but gives the module a new secret. ' +
                `Retrying in ${options.reconnectPeriod / 1000}s.`
            );
        } else if (action === 'secret-required') {
            this.logger.warn(
                `The controller refused module id "${this.clientId}" (CONNACK 5): it already has a secret this module doesn't hold, ` +
                'for example after a reinstall. Press "Forget" for this module in the controller\'s Settings > Paired devices. ' +
                `Retrying in ${options.reconnectPeriod / 1000}s.`
            );
        } else {
            this.logger.warn(`The controller refused the connection (code ${code}); retrying in ${options.reconnectPeriod / 1000}s`, { clientId: this.clientId });
        }
        return action;
    }

    /** A connection was accepted: back to the normal reconnect period. */
    handleConnected(options) {
        options.reconnectPeriod = this.baseReconnectPeriod;
    }
}

module.exports = {
    ModuleSecretAuth,
    MODULE_USERNAME,
    parseSecretMessage,
    isConnackRefusal,
    refusalAction,
    nextReconnectPeriod,
    connackReturnCode
};
