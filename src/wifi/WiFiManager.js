const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

/**
 * WiFiManager handles WiFi credential management for the EGOS module
 * Supports both NetworkManager and wpa_supplicant configurations
 */
class WiFiManager {
    constructor() {
        // Configuration paths
        this.networkManagerPath = '/etc/NetworkManager/system-connections/preconfigured.nmconnection';
        this.networkManagerDir = '/etc/NetworkManager/system-connections';
        this.wpaSupplicantPath = '/etc/wpa_supplicant/wpa_supplicant.conf';
        
        // Default credentials
        this.defaultSSID = 'egos';
        this.defaultPassword = 'egosegos';
        
        // Detected configuration system
        this.configSystem = null;
    }

    /**
     * Detect which WiFi configuration system is in use
     * @returns {Promise<string>} 'networkmanager', 'wpa_supplicant', or null
     */
    async detectConfigSystem() {
        if (this.configSystem) {
            return this.configSystem;
        }

        try {
            // Check for NetworkManager first
            await fs.access(this.networkManagerDir);
            this.configSystem = 'networkmanager';
            logger.info('Detected NetworkManager configuration system');
            return this.configSystem;
        } catch (error) {
            // NetworkManager not available, try wpa_supplicant
            try {
                await fs.access(this.wpaSupplicantPath);
                this.configSystem = 'wpa_supplicant';
                logger.info('Detected wpa_supplicant configuration system');
                return this.configSystem;
            } catch (wpaError) {
                logger.error('No WiFi configuration system detected');
                this.configSystem = null;
                return null;
            }
        }
    }

    /**
     * Get the current WiFi SSID from the configuration
     * @returns {Promise<string|null>} Current SSID or null if not found
     */
    async getCurrentSSID() {
        const system = await this.detectConfigSystem();
        
        if (!system) {
            logger.error('Cannot read current SSID: No configuration system detected');
            return null;
        }

        try {
            if (system === 'networkmanager') {
                return await this._getCurrentSSIDFromNetworkManager();
            } else {
                return await this._getCurrentSSIDFromWpaSupplicant();
            }
        } catch (error) {
            logger.error('Error reading current SSID:', error);
            return null;
        }
    }

    /**
     * Read SSID from NetworkManager configuration
     * @private
     */
    async _getCurrentSSIDFromNetworkManager() {
        try {
            const content = await fs.readFile(this.networkManagerPath, 'utf8');
            const match = content.match(/^ssid=(.+)$/m);
            
            if (match && match[1]) {
                const ssid = match[1].trim();
                logger.debug(`Current SSID from NetworkManager: ${ssid}`);
                return ssid;
            }
            
            logger.warn('Could not find SSID in NetworkManager configuration');
            return null;
        } catch (error) {
            logger.error('Error reading NetworkManager configuration:', error);
            return null;
        }
    }

    /**
     * Read SSID from wpa_supplicant configuration
     * @private
     */
    async _getCurrentSSIDFromWpaSupplicant() {
        try {
            const content = await fs.readFile(this.wpaSupplicantPath, 'utf8');
            const match = content.match(/ssid="([^"]+)"/);
            
            if (match && match[1]) {
                const ssid = match[1];
                logger.debug(`Current SSID from wpa_supplicant: ${ssid}`);
                return ssid;
            }
            
            logger.warn('Could not find SSID in wpa_supplicant configuration');
            return null;
        } catch (error) {
            logger.error('Error reading wpa_supplicant configuration:', error);
            return null;
        }
    }

    /**
     * Generate WPA-PSK from SSID and password
     * Uses the wpa_passphrase command-line utility
     * @param {string} ssid - WiFi network SSID
     * @param {string} password - WiFi password
     * @returns {Promise<string>} Generated PSK hex string
     */
    async generatePSK(ssid, password) {
        try {
            // Use wpa_passphrase to generate PSK
            // Escape special characters in ssid and password
            const escapedSSID = ssid.replace(/'/g, "'\\''");
            const escapedPassword = password.replace(/'/g, "'\\''");
            
            const command = `wpa_passphrase '${escapedSSID}' '${escapedPassword}' | grep '^\tpsk=' | cut -d= -f2`;
            const { stdout } = await execAsync(command);
            
            const psk = stdout.trim();
            
            if (!psk || psk.length !== 64) {
                throw new Error('Invalid PSK generated');
            }
            
            logger.debug('PSK generated successfully');
            return psk;
        } catch (error) {
            logger.error('Error generating PSK:', error);
            throw new Error(`Failed to generate PSK: ${error.message}`);
        }
    }

    /**
     * Update WiFi credentials
     * @param {string} ssid - New WiFi SSID
     * @param {string} password - New WiFi password
     * @returns {Promise<boolean>} True if credentials were updated, false if no change needed
     */
    async updateCredentials(ssid, password) {
        try {
            // Validate inputs
            if (!ssid || !password) {
                throw new Error('SSID and password are required');
            }

            // Check current SSID
            const currentSSID = await this.getCurrentSSID();
            
            if (currentSSID === ssid) {
                logger.info(`SSID unchanged (${ssid}), no update needed`);
                return false;
            }

            logger.info(`Updating WiFi credentials from "${currentSSID}" to "${ssid}"`);

            // Detect system and update accordingly
            const system = await this.detectConfigSystem();
            
            if (!system) {
                throw new Error('No WiFi configuration system detected');
            }

            if (system === 'networkmanager') {
                await this._updateNetworkManagerCredentials(ssid, password);
            } else {
                await this._updateWpaSupplicantCredentials(ssid, password);
            }

            logger.info('WiFi credentials updated successfully');
            return true;
        } catch (error) {
            logger.error('Error updating WiFi credentials:', error);
            throw error;
        }
    }

    /**
     * Update NetworkManager configuration
     * @private
     */
    async _updateNetworkManagerCredentials(ssid, password) {
        try {
            // Generate PSK
            const psk = await this.generatePSK(ssid, password);
            
            // Read current configuration
            const content = await fs.readFile(this.networkManagerPath, 'utf8');
            
            // Update SSID in [wifi] section
            let updatedContent = content.replace(
                /^ssid=.+$/m,
                `ssid=${ssid}`
            );
            
            // Update PSK in [wifi-security] section
            updatedContent = updatedContent.replace(
                /^psk=.+$/m,
                `psk=${psk}`
            );
            
            // Create backup
            const backupPath = `${this.networkManagerPath}.backup`;
            await fs.writeFile(backupPath, content);
            logger.debug('Created backup of NetworkManager configuration');
            
            // Write new configuration
            await fs.writeFile(this.networkManagerPath, updatedContent);
            
            // Set proper permissions (600 - owner read/write only)
            await fs.chmod(this.networkManagerPath, 0o600);
            
            logger.info('NetworkManager configuration updated');
            
            // Restart NetworkManager to apply changes
            try {
                await execAsync('systemctl restart NetworkManager');
                logger.info('NetworkManager restarted');
            } catch (restartError) {
                logger.warn('Could not restart NetworkManager, changes may require manual restart:', restartError);
            }
        } catch (error) {
            logger.error('Error updating NetworkManager configuration:', error);
            throw error;
        }
    }

    /**
     * Update wpa_supplicant configuration
     * @private
     */
    async _updateWpaSupplicantCredentials(ssid, password) {
        try {
            // Generate PSK for wpa_supplicant
            const psk = await this.generatePSK(ssid, password);
            
            // Read current configuration
            const content = await fs.readFile(this.wpaSupplicantPath, 'utf8');
            
            // Create the new network block
            const newNetworkBlock = `
network={
    ssid="${ssid}"
    psk=${psk}
}`;
            
            // Replace existing network block or append if not found
            let updatedContent;
            if (content.includes('network={')) {
                // Replace existing network block
                updatedContent = content.replace(
                    /network=\{[^}]*\}/s,
                    newNetworkBlock.trim()
                );
            } else {
                // Append new network block
                updatedContent = content + '\n' + newNetworkBlock;
            }
            
            // Create backup
            const backupPath = `${this.wpaSupplicantPath}.backup`;
            await fs.writeFile(backupPath, content);
            logger.debug('Created backup of wpa_supplicant configuration');
            
            // Write new configuration
            await fs.writeFile(this.wpaSupplicantPath, updatedContent);
            
            // Set proper permissions (600 - owner read/write only)
            await fs.chmod(this.wpaSupplicantPath, 0o600);
            
            logger.info('wpa_supplicant configuration updated');
            
            // Restart wpa_supplicant to apply changes
            try {
                await execAsync('systemctl restart wpa_supplicant');
                logger.info('wpa_supplicant restarted');
            } catch (restartError) {
                logger.warn('Could not restart wpa_supplicant, changes may require manual restart:', restartError);
            }
        } catch (error) {
            logger.error('Error updating wpa_supplicant configuration:', error);
            throw error;
        }
    }

    /**
     * Reset WiFi credentials to default (egos/egosegos)
     * @returns {Promise<boolean>} True if credentials were reset
     */
    async resetToDefault() {
        logger.info('Resetting WiFi credentials to default');
        return await this.updateCredentials(this.defaultSSID, this.defaultPassword);
    }

    /**
     * Reboot the device
     * @param {number} delayMs - Delay in milliseconds before reboot (default: 2000)
     */
    async rebootDevice(delayMs = 2000) {
        logger.info(`Rebooting device in ${delayMs}ms...`);
        
        setTimeout(async () => {
            try {
                await execAsync('sudo reboot');
            } catch (error) {
                logger.error('Error executing reboot command:', error);
                // Try alternative reboot methods
                try {
                    await execAsync('reboot');
                } catch (fallbackError) {
                    logger.error('Alternative reboot also failed:', fallbackError);
                }
            }
        }, delayMs);
    }
}

module.exports = WiFiManager;
