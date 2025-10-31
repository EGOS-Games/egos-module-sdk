# WiFi Credential Management

This module provides automated WiFi credential management for EGOS devices, allowing remote configuration updates via MQTT.

## Overview

The WiFi Manager handles credential updates for both NetworkManager and wpa_supplicant configuration systems, automatically detecting which is in use and updating the appropriate configuration files.

## Architecture

### Components

1. **WiFiManager** (`src/wifi/WiFiManager.js`)
   - Core credential management logic
   - Supports NetworkManager and wpa_supplicant
   - Handles SSID comparison, PSK generation, and device reboots

2. **MQTTClient Integration** (`src/mqtt/MQTTClient.js`)
   - Subscribes to credential topics during registration
   - Handles `credentials/set` and `credentials/reset` messages
   - Publishes acknowledgment messages

## MQTT Topics

### Subscribed Topics

- `${clientId}/credentials/set` - Set new WiFi credentials
- `${clientId}/credentials/reset` - Reset to default credentials

### Published Topics

- `${clientId}/credentials/updated` - Credentials successfully updated
- `${clientId}/credentials/unchanged` - SSID already configured
- `${clientId}/credentials/error` - Error during credential update

## Message Format

### credentials/set

```json
{
  "ssid": "MyNetwork",
  "password": "MyPassword123"
}
```

### credentials/reset

No payload required. Resets to default:
- SSID: `egos`
- Password: `egosegos`

## Behavior

### Credential Update Flow

1. **Receive credentials/set message**
2. **Check current SSID**
   - If same as new SSID → No action, publish `unchanged` message
   - If different → Proceed with update
3. **Update configuration file**
   - NetworkManager: `/etc/NetworkManager/system-connections/preconfigured.nmconnection`
   - wpa_supplicant: `/etc/wpa_supplicant/wpa_supplicant.conf`
4. **Generate WPA-PSK** (using `wpa_passphrase` utility)
5. **Write new configuration**
6. **Create backup** of old configuration
7. **Restart network service** (NetworkManager or wpa_supplicant)
8. **Publish acknowledgment message**
9. **Reboot device** (3 second delay)

### Credential Reset Flow

1. **Receive credentials/reset message**
2. **Update to default credentials** (egos/egosegos)
3. **Follow same flow as credential update**

## Configuration Files

### NetworkManager Format

```ini
[connection]
id=preconfigured
uuid=<uuid>
type=wifi

[wifi]
mode=infrastructure
ssid=<SSID>
hidden=false

[ipv4]
method=auto

[wifi-security]
key-mgmt=wpa-psk
psk=<64-character-hex-psk>
```

### wpa_supplicant Format

```
network={
    ssid="<SSID>"
    psk=<64-character-hex-psk>
}
```

## Security Considerations

1. **File Permissions**: Configuration files are set to `600` (owner read/write only)
2. **Backups**: Original configurations are backed up before modification
3. **PSK Generation**: Passwords are converted to WPA-PSK hex format
4. **Logging**: Passwords are never logged in plaintext

## System Requirements

- `wpa_passphrase` utility (for PSK generation)
- Root/sudo access (for config file modification and reboot)
- NetworkManager or wpa_supplicant installed

## Error Handling

The system handles several error scenarios:

1. **Invalid payload**: Missing SSID or password
2. **File access errors**: Configuration file not found or not writable
3. **PSK generation errors**: Invalid SSID/password combination
4. **Service restart errors**: Network service fails to restart (logged as warning)

All errors are:
- Logged with full error details
- Published to `${clientId}/credentials/error` topic
- Do not cause device reboot

## Testing

### Manual Testing

1. **Test credential update**:
```javascript
broker.publish('module123/credentials/set', {
    ssid: 'TestNetwork',
    password: 'TestPassword123'
}, { qos: 1 });
```

2. **Test credential reset**:
```javascript
broker.publish('module123/credentials/reset', {}, { qos: 1 });
```

3. **Test unchanged credentials**:
```javascript
// Send same SSID as currently configured
broker.publish('module123/credentials/set', {
    ssid: 'CurrentSSID',
    password: 'AnyPassword'
}, { qos: 1 });
```

## Troubleshooting

### Device not rebooting

- Check system logs: `journalctl -u NetworkManager` or `journalctl -u wpa_supplicant`
- Verify sudo/root permissions
- Check for manual reboot: `sudo reboot`

### Credentials not updating

- Check file permissions on configuration files
- Verify `wpa_passphrase` is installed: `which wpa_passphrase`
- Check MQTT subscription: Look for "Successfully subscribed to .../credentials/set"
- Review WiFiManager logs

### Network not connecting after update

- Check backup file: `.nmconnection.backup` or `.conf.backup`
- Restore manually if needed
- Verify SSID and password are correct
- Check network service status: `systemctl status NetworkManager`

## Future Enhancements

Potential improvements:

1. Support for enterprise WiFi (802.1X)
2. Support for hidden networks
3. Multiple network profiles
4. WiFi strength reporting
5. Connection status feedback
6. Rollback on connection failure
