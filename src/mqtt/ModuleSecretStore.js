const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Module secret (protocol v1, egos-cloud#1197): 43 characters of base64url,
 * the encoding of 32 random bytes without padding.
 */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isValidSecret(secret) {
    return typeof secret === 'string' && SECRET_PATTERN.test(secret);
}

/**
 * Where the secret lives when no `secretFile` is given:
 * `~/.egos/module-secret-<clientId>`, one file per module id.
 */
function defaultSecretFile(clientId) {
    const safeId = String(clientId).replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(os.homedir(), '.egos', `module-secret-${safeId}`);
}

/**
 * Keeps the module secret the controller gave this module in a file of its
 * own, readable only by the module's user (mode 0600). It is kept apart from
 * the WiFi settings, which `credentials/reset` erases.
 *
 * Never log the secret, not even part of it.
 */
class ModuleSecretStore {
    constructor({ filePath }) {
        if (!filePath) {
            throw new Error('ModuleSecretStore needs a filePath');
        }
        this.filePath = filePath;
    }

    /**
     * The stored secret, or null when there is none or the file doesn't hold
     * a valid one.
     */
    load() {
        let text;
        try {
            text = fs.readFileSync(this.filePath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
        const secret = text.trim();
        return isValidSecret(secret) ? secret : null;
    }

    /**
     * Stores the secret atomically: a temporary file next to the target,
     * written with mode 0600 and flushed, then renamed over it.
     */
    save(secret) {
        if (!isValidSecret(secret)) {
            throw new Error('Refusing to store an invalid module secret');
        }
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tempPath = `${this.filePath}.tmp-${process.pid}`;
        let fd;
        try {
            fd = fs.openSync(tempPath, 'w', 0o600);
            fs.writeSync(fd, secret);
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = undefined;
            // openSync's mode only applies to a new file; make sure of it
            fs.chmodSync(tempPath, 0o600);
            fs.renameSync(tempPath, this.filePath);
        } catch (error) {
            if (fd !== undefined) {
                try { fs.closeSync(fd); } catch (closeError) { /* already failing */ }
            }
            try { fs.unlinkSync(tempPath); } catch (unlinkError) { /* may not exist */ }
            throw error;
        }
    }

    /** Deletes the stored secret. Returns true when there was a file. */
    clear() {
        try {
            fs.unlinkSync(this.filePath);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
    }
}

module.exports = {
    ModuleSecretStore,
    isValidSecret,
    defaultSecretFile
};
