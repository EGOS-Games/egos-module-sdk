// Checks ModuleSecretAuth against the installed mqtt.js and a minimal fake
// broker: that mqtt.js reconnects after a refused CONNACK when
// reconnectOnConnackError is set, and that it sends the username and
// password from client.options on every reconnect. Wired the same way as
// src/mqtt/MQTTClient.js (which can't be loaded here: it needs rpio).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const mqtt = require('mqtt');
const mqttPacket = require('mqtt-packet');
const { ModuleSecretAuth, isConnackRefusal } = require('../src/mqtt/ModuleSecretAuth');

const CLIENT_ID = 'audio-a1b2c3';
const OLD_SECRET = 'o'.repeat(43);
const NEW_SECRET = 'N'.repeat(21) + '-_' + 'x4'.repeat(10);

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function memoryStore(initial) {
    return {
        secret: initial,
        load() { return this.secret; },
        save(secret) { this.secret = secret; },
        clear() { this.secret = null; return true; }
    };
}

/**
 * A fake broker. `decide(connect)` returns the CONNACK return code for each
 * CONNECT; every CONNECT is recorded. On a subscription to the secret topic
 * it sends `secretPayload` at QoS 1.
 */
function startBroker({ decide, secretPayload }) {
    const connects = [];
    const subscriptions = [];
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        const parser = mqttPacket.parser({ protocolVersion: 4 });
        parser.on('packet', (packet) => {
            if (packet.cmd === 'connect') {
                const record = {
                    clientId: packet.clientId,
                    username: packet.username,
                    password: packet.password === undefined ? undefined : packet.password.toString('utf8')
                };
                connects.push(record);
                const returnCode = decide(record, connects.length);
                socket.write(mqttPacket.generate({ cmd: 'connack', returnCode, sessionPresent: false }));
                if (returnCode !== 0) socket.end();
            } else if (packet.cmd === 'subscribe') {
                for (const sub of packet.subscriptions) subscriptions.push(sub);
                socket.write(mqttPacket.generate({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map((sub) => sub.qos) }));
                for (const sub of packet.subscriptions) {
                    if (sub.topic === `${CLIENT_ID}/module/secret` && secretPayload) {
                        socket.write(mqttPacket.generate({
                            cmd: 'publish', topic: sub.topic, payload: Buffer.from(JSON.stringify(secretPayload)),
                            qos: 1, messageId: 1, retain: false, dup: false
                        }));
                    }
                }
            } else if (packet.cmd === 'pingreq') {
                socket.write(mqttPacket.generate({ cmd: 'pingresp' }));
            }
        });
        socket.on('data', (data) => parser.parse(data));
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                connects,
                subscriptions,
                close: () => new Promise((done) => {
                    for (const socket of sockets) socket.destroy();
                    server.close(done);
                })
            });
        });
    });
}

function connectModule(port, auth) {
    const { username, password } = auth.credentials();
    const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
        clientId: CLIENT_ID,
        username,
        password,
        keepalive: 30,
        connectTimeout: 5000,
        reconnectPeriod: 50,
        reconnectOnConnackError: true
    });
    client.on('error', (error) => {
        if (isConnackRefusal(error)) auth.handleConnackError(error.code, client.options);
    });
    client.on('connect', () => {
        auth.handleConnected(client.options);
        client.subscribe(auth.topic, { qos: 1 });
    });
    client.on('message', (topic, message) => {
        if (topic === auth.topic) auth.handleSecretMessage(message, client.options);
    });
    return client;
}

function waitFor(predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - started > timeoutMs) {
                clearInterval(timer);
                reject(new Error('timed out'));
            }
        }, 10);
    });
}

test('CONNACK 4 clears the stored secret; the module reconnects without one, stores the new one and uses it next time', async () => {
    const broker = await startBroker({
        // Refuse the forgotten secret, accept everything else
        decide: (connect) => (connect.password === OLD_SECRET ? 4 : 0),
        secretPayload: { secret: NEW_SECRET, version: 1 }
    });
    const store = memoryStore(OLD_SECRET);
    const auth = new ModuleSecretAuth({ clientId: CLIENT_ID, store, logger: silentLogger, baseReconnectPeriod: 50 });
    const client = connectModule(broker.port, auth);
    try {
        await waitFor(() => store.secret === NEW_SECRET);
        assert.deepEqual(broker.connects.slice(0, 2).map((c) => [c.username, c.password]), [['module', OLD_SECRET], ['module', '']]);
        assert.ok(broker.subscriptions.some((sub) => sub.topic === `${CLIENT_ID}/module/secret` && sub.qos === 1));
        // The new secret is not used by this connection, only by the next one
        assert.equal(broker.connects.length, 2);
        client.stream.destroy();
        await waitFor(() => broker.connects.length === 3);
        assert.deepEqual([broker.connects[2].username, broker.connects[2].password], ['module', NEW_SECRET]);
    } finally {
        client.end(true);
        await broker.close();
    }
});

test('CONNACK 5 with an empty password keeps retrying with backoff', async () => {
    const broker = await startBroker({ decide: () => 5 });
    const store = memoryStore(null);
    const auth = new ModuleSecretAuth({ clientId: CLIENT_ID, store, logger: silentLogger, baseReconnectPeriod: 20, maxReconnectPeriod: 160 });
    const client = connectModule(broker.port, auth);
    try {
        await waitFor(() => broker.connects.length >= 4);
        assert.ok(broker.connects.every((c) => c.username === 'module' && c.password === ''));
        assert.ok(client.options.reconnectPeriod >= 80);
        assert.equal(store.secret, null);
    } finally {
        client.end(true);
        await broker.close();
    }
});
