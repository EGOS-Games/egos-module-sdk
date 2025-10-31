# WiFi Manager - Sudo Configuration

## Changes Made

Updated `WiFiManager.js` to use `sudo` for all privileged operations:

### File Reading Operations
- ✅ `_getCurrentSSIDFromNetworkManager()` - Now uses `sudo cat`
- ✅ `_getCurrentSSIDFromWpaSupplicant()` - Now uses `sudo cat`

### File Writing Operations
- ✅ `_updateNetworkManagerCredentials()` - Uses temp file + `sudo mv`
- ✅ `_updateWpaSupplicantCredentials()` - Uses temp file + `sudo mv`

### Other Privileged Operations
- ✅ File backups - Uses `sudo cp`
- ✅ File permissions - Uses `sudo chmod`
- ✅ Service restarts - Uses `sudo systemctl restart`
- ✅ Device reboot - Uses `sudo reboot`

## Required Sudo Configuration

The Node.js process (running as `pi` user) needs passwordless sudo access for specific commands.

### Setup Instructions

1. **Edit sudoers file:**
```bash
sudo visudo
```

2. **Add the following lines at the end:**
```
# Allow pi user to manage WiFi credentials without password
pi ALL=(ALL) NOPASSWD: /bin/cat /etc/NetworkManager/system-connections/*
pi ALL=(ALL) NOPASSWD: /bin/cat /etc/wpa_supplicant/wpa_supplicant.conf
pi ALL=(ALL) NOPASSWD: /bin/cp /etc/NetworkManager/system-connections/* /etc/NetworkManager/system-connections/*.backup
pi ALL=(ALL) NOPASSWD: /bin/cp /etc/wpa_supplicant/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant.conf.backup
pi ALL=(ALL) NOPASSWD: /bin/mv /tmp/egos-wifi-config.tmp /etc/NetworkManager/system-connections/preconfigured.nmconnection
pi ALL=(ALL) NOPASSWD: /bin/mv /tmp/egos-wpa-config.tmp /etc/wpa_supplicant/wpa_supplicant.conf
pi ALL=(ALL) NOPASSWD: /bin/chmod 600 /etc/NetworkManager/system-connections/*
pi ALL=(ALL) NOPASSWD: /bin/chmod 600 /etc/wpa_supplicant/wpa_supplicant.conf
pi ALL=(ALL) NOPASSWD: /bin/systemctl restart NetworkManager
pi ALL=(ALL) NOPASSWD: /bin/systemctl restart wpa_supplicant
pi ALL=(ALL) NOPASSWD: /sbin/reboot
```

3. **Save and exit** (Ctrl+X, then Y, then Enter in nano)

### Alternative: Less Restrictive (Use with caution)

If you want a simpler configuration (less secure but easier to manage):

```bash
sudo visudo
```

Add:
```
# Allow pi user passwordless sudo for all commands (LESS SECURE)
pi ALL=(ALL) NOPASSWD: ALL
```

⚠️ **Security Warning:** This gives the pi user full sudo access without a password. Only use this in controlled/development environments.

### Verify Sudo Configuration

Test that sudo works without password:

```bash
# Test reading config
sudo cat /etc/NetworkManager/system-connections/preconfigured.nmconnection

# Test system restart
sudo systemctl restart NetworkManager

# Should not prompt for password
```

## How It Works

### File Writing Strategy

Instead of trying to write directly to protected files, we:

1. **Create temp file** in `/tmp/` (no sudo needed)
2. **Write content** to temp file using Node.js `fs`
3. **Move temp file** to final location using `sudo mv`
4. **Set permissions** using `sudo chmod`

This approach:
- ✅ Avoids complex sudo file writing
- ✅ Works reliably across systems
- ✅ Maintains file ownership and permissions
- ✅ Allows for atomic file updates

### Example Flow

```javascript
// 1. Write to temp file (no sudo)
await fs.writeFile('/tmp/egos-wifi-config.tmp', content);

// 2. Move to protected location (sudo)
await execAsync('sudo mv /tmp/egos-wifi-config.tmp /etc/NetworkManager/...');

// 3. Set permissions (sudo)
await execAsync('sudo chmod 600 /etc/NetworkManager/...');
```

## Testing

After configuring sudo, test the credential update:

```bash
# Start your module
node module-av.js

# From controller, send credentials
# Should work without permission errors
```

Expected output:
```
info: Processing credentials/set for SSID: YourNetwork
info: Detected NetworkManager configuration system
debug: Current SSID from NetworkManager: OldNetwork
info: Updating WiFi credentials from "OldNetwork" to "YourNetwork"
debug: PSK generated successfully
debug: Created backup of NetworkManager configuration
info: NetworkManager configuration updated
info: NetworkManager restarted
info: WiFi credentials changed, rebooting device...
```

## Security Considerations

### What We Did
- ✅ Use specific command paths (e.g., `/bin/cat` not just `cat`)
- ✅ Limit permissions to specific files/paths
- ✅ Use temp files in `/tmp/` for intermediate storage
- ✅ Never log passwords in plaintext
- ✅ Set proper file permissions (600) after writing

### What to Consider
- 🔒 Only add sudo permissions on trusted devices
- 🔒 Review sudoers entries regularly
- 🔒 Monitor system logs for unusual sudo usage
- 🔒 Keep the Node.js module code secure
- 🔒 Validate all inputs before using in shell commands

## Troubleshooting

### "sudo: no tty present and no askpass program specified"

**Cause:** Sudo requires password but none provided

**Solution:** Ensure NOPASSWD is set in sudoers file

### "sudo: command not found"

**Cause:** Sudo not installed (rare)

**Solution:** 
```bash
apt-get install sudo
```

### Permission denied even with sudo

**Cause:** Sudoers file not configured correctly

**Solution:** 
1. Check sudoers: `sudo visudo`
2. Verify entries match exactly
3. Test with: `sudo -l` (shows allowed commands)

### Module still getting EACCES errors

**Possible causes:**
1. Sudoers file not saved properly
2. Wrong user (not running as `pi`)
3. Typo in sudoers paths
4. SELinux or AppArmor blocking (rare on Pi)

**Debug:**
```bash
# Check who you are
whoami

# Check sudo config
sudo -l

# Try manual command
sudo cat /etc/NetworkManager/system-connections/preconfigured.nmconnection
```

## Production Deployment Checklist

- [ ] Configure sudoers file on all devices
- [ ] Test credential update on one device first
- [ ] Verify backup files are created
- [ ] Test reboot and reconnection
- [ ] Monitor logs for errors
- [ ] Document any device-specific configurations
- [ ] Have physical access plan if WiFi update fails

## Rollback Procedure

If credentials fail and device loses connectivity:

1. **Physical access to device**
2. **Restore from backup:**
```bash
sudo cp /etc/NetworkManager/system-connections/preconfigured.nmconnection.backup \
        /etc/NetworkManager/system-connections/preconfigured.nmconnection
sudo systemctl restart NetworkManager
```
3. **Or use wpa_supplicant backup:**
```bash
sudo cp /etc/wpa_supplicant/wpa_supplicant.conf.backup \
        /etc/wpa_supplicant/wpa_supplicant.conf
sudo systemctl restart wpa_supplicant
```
