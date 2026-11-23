const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { ModuleSecretAuth } = require('../src/mqtt/ModuleSecretAuth');
const { connectModuleClient } = require('../src/mqtt/connectModuleClient');

const SECRET = 'S'.repeat(21) + '_-' + 'p3'.repeat(10);
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function memoryStore(initial) {
    return {
        secret: initial,
        load() { return this.secret; },
        save(secret) { this.secret = secret; },
        clear() { this.secret = null; return true; }
    };
}

/** A stand-in for the mqtt module: records connect() and returns an emitter. */
function fakeMqtt() {
    const calls = [];
    return {
        calls,
        connect(url, options) {
            const client = new EventEmitter();
            client.options = options;
            calls.push({ url, options, client });
            return client;
        }
    };
}

function setup(stored) {
    const store = memoryStore(stored);
    const secretAuth = new ModuleSecretAuth({ clientId: 'dmx-aabbcc', store, logger: silentLogger, baseReconnectPeriod: 1000 });
    const mqttModule = fakeMqtt();
    const forwarded = [];
    const client = connectModuleClient(mqttModule, {
        brokerUrl: 'mqtt://egos.local:1883',
        clientId: 'dmx-aabbcc',
        secretAuth,
        logger: silentLogger,
        onMessage: (topic, message) => forwarded.push([topic, message.toString()]),
        connectOptions: { keepalive: 2, reconnectPeriod: 1000, will: { topic: 'client/disconnect', payload: 'x', qos: 1, retain: false } }
    });
    return { store, client, mqttModule, forwarded };
}

test('connects with the client id, username module, the stored secret and reconnectOnConnackError', () => {
    const { mqttModule } = setup(SECRET);
    assert.equal(mqttModule.calls.length, 1);
    const { url, options } = mqttModule.calls[0];
    assert.equal(url, 'mqtt://egos.local:1883');
    assert.equal(options.clientId, 'dmx-aabbcc');
    assert.equal(options.username, 'module');
    assert.equal(options.password, SECRET);
    // mqtt.js 5.16+ stops reconnecting after a refused CONNACK without this
    assert.equal(options.reconnectOnConnackError, true);
    // The caller's options are kept
    assert.equal(options.keepalive, 2);
    assert.equal(options.will.topic, 'client/disconnect');
});

test('connects with an empty password when there is no secret', () => {
    const { mqttModule } = setup(null);
    assert.equal(mqttModule.calls[0].options.password, '');
});

test('the secret message is stored and not passed on; other messages are', () => {
    const { client, store, forwarded } = setup(null);
    client.emit('message', 'dmx-aabbcc/module/secret', Buffer.from(JSON.stringify({ secret: SECRET, version: 1 })));
    client.emit('message', 'dmx-aabbcc/device/1/output', Buffer.from('{"on":true}'));
    assert.equal(store.secret, SECRET);
    assert.equal(client.options.password, SECRET);
    assert.deepEqual(forwarded, [['dmx-aabbcc/device/1/output', '{"on":true}']]);
});

test('a refused CONNACK 4 clears the secret in client.options; other errors do not', () => {
    const { client, store } = setup(SECRET);
    client.emit('error', Object.assign(new Error('Publish error: Not authorized'), { code: 135 }));
    client.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    assert.equal(store.secret, SECRET);
    assert.equal(client.options.password, SECRET);
    client.emit('error', Object.assign(new Error('Connection refused: Bad username or password'), { code: 4 }));
    assert.equal(store.secret, null);
    assert.equal(client.options.password, '');
});

test('a refused CONNACK 5 backs off and a connect resets the period', () => {
    const { client } = setup(null);
    client.emit('error', Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }));
    assert.equal(client.options.reconnectPeriod, 2000);
    client.emit('connect');
    assert.equal(client.options.reconnectPeriod, 1000);
});
