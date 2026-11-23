const { isConnackRefusal } = require('./ModuleSecretAuth');

/**
 * Connects a module to the controller's broker with its module secret
 * (protocol v1, egos-cloud#1197) and wires the secret handling into the
 * mqtt.js client:
 * - the username and password come from `secretAuth.credentials()`;
 * - `reconnectOnConnackError` is on, because mqtt.js 5.16+ stops
 *   reconnecting after a refused CONNACK without it;
 * - a refused CONNACK updates `client.options` (username, password,
 *   reconnect period), which mqtt.js reads again on the next reconnect. These
 *   listeners are added first, so they run before the caller's own;
 * - a message on `{id}/module/secret` is handled here and never passed to
 *   `onMessage`, so the payload can't reach a log or an app callback.
 *
 * Takes the `mqtt` module as an argument so tests can run it against a fake
 * broker or a fake mqtt module.
 *
 * @param {object} mqttModule - the `mqtt` package (or a stand-in with `connect`)
 * @param {object} params
 * @param {string} params.brokerUrl
 * @param {string} params.clientId - the module id; unchanged by the secret
 * @param {import('./ModuleSecretAuth').ModuleSecretAuth} params.secretAuth
 * @param {object} [params.connectOptions] - other mqtt.js options (will, keepalive, reconnectPeriod...)
 * @param {function(string, Buffer): void} [params.onMessage] - every message except the secret
 * @param {object} params.logger
 * @returns the mqtt.js client
 */
function connectModuleClient(mqttModule, { brokerUrl, clientId, secretAuth, connectOptions = {}, onMessage = () => {}, logger }) {
    const { username, password } = secretAuth.credentials();
    const client = mqttModule.connect(brokerUrl, {
        ...connectOptions,
        clientId,
        username,
        password,
        reconnectOnConnackError: true
    });

    client.on('connect', () => {
        secretAuth.handleConnected(client.options);
    });

    client.on('error', (error) => {
        if (isConnackRefusal(error)) {
            secretAuth.handleConnackError(error.code, client.options);
        }
    });

    client.on('message', (topic, message) => {
        if (topic === secretAuth.topic) {
            try {
                secretAuth.handleSecretMessage(message, client.options);
            } catch (error) {
                logger.error('Error handling the module secret message', { error: error.message });
            }
            return;
        }
        onMessage(topic, message);
    });

    return client;
}

module.exports = { connectModuleClient };
