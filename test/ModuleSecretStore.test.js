const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ModuleSecretStore, isValidSecret, defaultSecretFile } = require('../src/mqtt/ModuleSecretStore');

const SECRET = 'A'.repeat(20) + '-_' + 'b9'.repeat(10) + 'z';

let dir;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egos-secret-'));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the fixture secret is valid', () => {
    assert.equal(SECRET.length, 43);
    assert.ok(isValidSecret(SECRET));
});

test('isValidSecret accepts only 43 chars of base64url', () => {
    assert.equal(isValidSecret('a'.repeat(42)), false);
    assert.equal(isValidSecret('a'.repeat(44)), false);
    assert.equal(isValidSecret('a'.repeat(42) + '='), false);
    assert.equal(isValidSecret('a'.repeat(42) + '+'), false);
    assert.equal(isValidSecret(null), false);
    assert.equal(isValidSecret(12), false);
});

test('load returns null when there is no file', () => {
    const store = new ModuleSecretStore({ filePath: path.join(dir, 'missing') });
    assert.equal(store.load(), null);
});

test('save then load returns the secret, creating the directory', () => {
    const filePath = path.join(dir, 'nested', '.egos', 'module-secret-x');
    const store = new ModuleSecretStore({ filePath });
    store.save(SECRET);
    assert.equal(store.load(), SECRET);
    assert.equal(fs.readFileSync(filePath, 'utf8'), SECRET);
    // No temporary file is left behind
    assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['module-secret-x']);
});

test('the file is mode 0600', { skip: process.platform === 'win32' ? 'POSIX file modes only' : false }, () => {
    const filePath = path.join(dir, 'module-secret');
    const store = new ModuleSecretStore({ filePath });
    store.save(SECRET);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('save replaces an existing secret', () => {
    const filePath = path.join(dir, 'module-secret');
    const store = new ModuleSecretStore({ filePath });
    store.save(SECRET);
    const other = 'Z'.repeat(43);
    store.save(other);
    assert.equal(store.load(), other);
});

test('save refuses an invalid secret and leaves the file alone', () => {
    const filePath = path.join(dir, 'module-secret');
    const store = new ModuleSecretStore({ filePath });
    store.save(SECRET);
    assert.throws(() => store.save('short'));
    assert.equal(store.load(), SECRET);
});

test('load ignores a file that does not hold a valid secret', () => {
    const filePath = path.join(dir, 'module-secret');
    fs.writeFileSync(filePath, 'garbage');
    assert.equal(new ModuleSecretStore({ filePath }).load(), null);
});

test('load tolerates a trailing newline', () => {
    const filePath = path.join(dir, 'module-secret');
    fs.writeFileSync(filePath, SECRET + '\n');
    assert.equal(new ModuleSecretStore({ filePath }).load(), SECRET);
});

test('clear deletes the file and reports whether there was one', () => {
    const filePath = path.join(dir, 'module-secret');
    const store = new ModuleSecretStore({ filePath });
    store.save(SECRET);
    assert.equal(store.clear(), true);
    assert.equal(store.load(), null);
    assert.equal(store.clear(), false);
});

test('defaultSecretFile is per client id under ~/.egos, with a safe file name', () => {
    assert.equal(defaultSecretFile('audio-a1b2c3'), path.join(os.homedir(), '.egos', 'module-secret-audio-a1b2c3'));
    assert.equal(path.basename(defaultSecretFile('../x/y')), 'module-secret-.._x_y');
    assert.equal(path.dirname(defaultSecretFile('../x/y')), path.join(os.homedir(), '.egos'));
});
