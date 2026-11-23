const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    ModuleSecretAuth,
    MODULE_USERNAME,
    parseSecretMessage,
    isConnackRefusal,
    refusalAction,
    nextReconnectPeriod
} = require('../src/mqtt/ModuleSecretAuth');

const SECRET = 'k'.repeat(21) + '_-' + 'Q7'.repeat(10);

function memoryStore(initial = null, { failSave = false } = {}) {
    return {
        secret: initial,
        load() { return this.secret; },
        save(secret) {
            if (failSave) throw new Error('EROFS: read-only file system');
            this.secret = secret;
        },
        clear() {
            const had = this.secret !== null;
            this.secret = null;
            return had;
        }
    };
}

function recordingLogger() {
    const lines = [];
    const record = (level) => (...args) => lines.push({
        level,
        text: args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
    });
    return { lines, info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') };
}

function makeAuth(store, logger = recordingLogger()) {
    const auth = new ModuleSecretAuth({ clientId: 'audio-a1b2c3', store, logger, baseReconnectPeriod: 1000, maxReconnectPeriod: 8000 });
    return { auth, logger };
}

function assertNeverLogged(logger, secret) {
    for (const line of logger.lines) {
        assert.ok(!line.text.includes(secret.slice(0, 8)), `secret leaked in a ${line.level} log line`);
    }
}

test('the fixture secret is 43 chars', () => {
    assert.equal(SECRET.length, 43);
});

test('topic is {id}/module/secret', () => {
    const { auth } = makeAuth(memoryStore());
    assert.equal(auth.topic, 'audio-a1b2c3/module/secret');
});

test('credentials: username module and an empty password without a secret', () => {
    const { auth } = makeAuth(memoryStore());
    assert.equal(MODULE_USERNAME, 'module');
    assert.deepEqual(auth.credentials(), { username: 'module', password: '' });
});

test('credentials: the stored secret as the password', () => {
    const { auth } = makeAuth(memoryStore(SECRET));
    assert.deepEqual(auth.credentials(), { username: 'module', password: SECRET });
});

test('credentials: an unreadable store means connecting without a secret, and says so', () => {
    const store = {
        filePath: '/home/pi/.egos/module-secret-audio-a1b2c3',
        load() { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); }
    };
    const { auth, logger } = makeAuth(store);
    assert.deepEqual(auth.credentials(), { username: 'module', password: '' });
    assert.equal(logger.lines[0].level, 'error');
    assert.match(logger.lines[0].text, /module-secret-audio-a1b2c3 \(EACCES\)/);
    assert.match(logger.lines[0].text, /permissions/);
});

test('CONNACK 5 after an unreadable store points at the file, not only at Forget', () => {
    const store = {
        filePath: '/home/pi/.egos/module-secret-audio-a1b2c3',
        load() { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); }
    };
    const { auth, logger } = makeAuth(store);
    const options = { ...auth.credentials(), reconnectPeriod: 1000 };
    assert.equal(auth.handleConnackError(5, options), 'secret-required');
    const last = logger.lines[logger.lines.length - 1].text;
    assert.match(last, /could not be read \(EACCES\)/);
    assert.match(last, /permissions/);
});

test('a secret message on a connection that already uses a secret is ignored', () => {
    const store = memoryStore(SECRET);
    const { auth, logger } = makeAuth(store);
    const options = { username: 'module', password: SECRET };
    const forged = 'F'.repeat(43);
    assert.equal(auth.handleSecretMessage(JSON.stringify({ secret: forged, version: 1 }), options), false);
    assert.equal(store.secret, SECRET);
    assert.equal(options.password, SECRET);
    assert.ok(logger.lines.some((line) => /already uses a secret/.test(line.text)));
    assertNeverLogged(logger, forged);
    assertNeverLogged(logger, SECRET);
});

test('parseSecretMessage takes only a valid v1 payload', () => {
    assert.equal(parseSecretMessage(Buffer.from(JSON.stringify({ secret: SECRET, version: 1 }))), SECRET);
    assert.equal(parseSecretMessage(JSON.stringify({ secret: SECRET, version: 2 })), null);
    assert.equal(parseSecretMessage(JSON.stringify({ secret: SECRET })), null);
    assert.equal(parseSecretMessage(JSON.stringify({ secret: SECRET.slice(1), version: 1 })), null);
    assert.equal(parseSecretMessage(JSON.stringify({ secret: SECRET.slice(1) + '/', version: 1 })), null);
    assert.equal(parseSecretMessage('not json ' + SECRET), null);
    assert.equal(parseSecretMessage('null'), null);
});

test('a secret message is stored and used from the next connection, and never logged', () => {
    const store = memoryStore();
    const { auth, logger } = makeAuth(store);
    const options = { username: 'module', password: '' };
    const taken = auth.handleSecretMessage(Buffer.from(JSON.stringify({ secret: SECRET, version: 1 })), options);
    assert.equal(taken, true);
    assert.equal(store.secret, SECRET);
    assert.equal(options.password, SECRET);
    assert.ok(logger.lines.some((line) => line.text === 'Module secret stored'));
    assertNeverLogged(logger, SECRET);
});

test('an invalid secret message changes nothing and is not logged', () => {
    const store = memoryStore();
    const { auth, logger } = makeAuth(store);
    const options = { username: 'module', password: '' };
    const bad = SECRET.slice(0, 40);
    assert.equal(auth.handleSecretMessage(JSON.stringify({ secret: bad, version: 1 }), options), false);
    assert.equal(store.secret, null);
    assert.equal(options.password, '');
    assertNeverLogged(logger, bad);
});

test('a secret that cannot be stored is still used until the module restarts', () => {
    const { auth, logger } = makeAuth(memoryStore(null, { failSave: true }));
    const options = { password: '' };
    assert.equal(auth.handleSecretMessage(JSON.stringify({ secret: SECRET, version: 1 }), options), true);
    assert.equal(options.password, SECRET);
    assert.ok(logger.lines.some((line) => line.level === 'error'));
    assertNeverLogged(logger, SECRET);
});

test('refusalAction', () => {
    assert.equal(refusalAction(4, true), 'clear-secret');
    assert.equal(refusalAction(134, true), 'clear-secret');
    assert.equal(refusalAction(4, false), 'refused');
    assert.equal(refusalAction(5, false), 'secret-required');
    assert.equal(refusalAction(135, false), 'secret-required');
    assert.equal(refusalAction(5, true), 'refused');
    assert.equal(refusalAction(2, false), 'refused');
});

test('isConnackRefusal tells refused CONNACKs from other errors', () => {
    const refused = Object.assign(new Error('Connection refused: Bad username or password'), { code: 4 });
    assert.equal(isConnackRefusal(refused), true);
    assert.equal(isConnackRefusal(Object.assign(new Error('Publish error: Not authorized'), { code: 135 })), false);
    assert.equal(isConnackRefusal(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), false);
    assert.equal(isConnackRefusal(undefined), false);
});

test('CONNACK 4 with a stored secret clears it and reconnects with an empty password', () => {
    const store = memoryStore(SECRET);
    const { auth, logger } = makeAuth(store);
    const options = { username: 'module', password: SECRET, reconnectPeriod: 4000 };
    assert.equal(auth.handleConnackError(4, options), 'clear-secret');
    assert.equal(store.secret, null);
    assert.equal(options.username, 'module');
    assert.equal(options.password, '');
    assert.equal(options.reconnectPeriod, 1000);
    assert.ok(logger.lines.some((line) => /secret cleared/.test(line.text)));
    assertNeverLogged(logger, SECRET);
});

test('CONNACK 5 with an empty password backs off and tells the operator to press Forget', () => {
    const { auth, logger } = makeAuth(memoryStore());
    const options = { username: 'module', password: '', reconnectPeriod: 1000 };
    const periods = [];
    for (let i = 0; i < 5; i++) {
        assert.equal(auth.handleConnackError(5, options), 'secret-required');
        periods.push(options.reconnectPeriod);
    }
    assert.deepEqual(periods, [2000, 4000, 8000, 8000, 8000]);
    assert.equal(options.password, '');
    assert.ok(logger.lines.every((line) => line.level === 'warn' && /Forget/.test(line.text)));
    auth.handleConnected(options);
    assert.equal(options.reconnectPeriod, 1000);
});

test('other refusals back off and keep the stored secret', () => {
    const store = memoryStore(SECRET);
    const { auth } = makeAuth(store);
    const options = { username: 'module', password: SECRET, reconnectPeriod: 1000 };
    assert.equal(auth.handleConnackError(5, options), 'refused');
    assert.equal(store.secret, SECRET);
    assert.equal(options.password, SECRET);
    assert.equal(options.reconnectPeriod, 2000);
});

test('nextReconnectPeriod doubles up to the maximum', () => {
    assert.equal(nextReconnectPeriod(undefined, 1000, 60000), 2000);
    assert.equal(nextReconnectPeriod(40000, 1000, 60000), 60000);
    assert.equal(nextReconnectPeriod(500, 1000, 60000), 2000);
});
