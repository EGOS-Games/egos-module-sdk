# EGOS Module SDK - Development & Deployment Guide

## Overview

The EGOS Module SDK provides reusable components for building reliable hardware modules. This guide covers both local development and npm publishing workflows.

## 📁 Project Structure

```
egos-module-sdk/
├── src/
│   ├── components/
│   │   ├── input/
│   │   │   ├── BaseInput.js       # Foundation class
│   │   │   ├── SerialInput.js     # Serial port handling
│   │   │   ├── PollingInput.js    # Async polling
│   │   │   ├── RfidInput.js       # RFID implementation
│   │   │   └── QRInput.js         # QR scanner implementation
│   ├── mqtt/
│   │   └── MQTTClient.js          # Enhanced MQTT client
│   ├── utils/
│   │   └── logger.js              # Structured logging
│   └── index.js                   # Main exports
├── package.json
└── README.md
```

## 🚀 Local Development Setup

### Option 1: File Path Dependency (Recommended for Development)

1. **Set up the SDK project:**
   ```bash
   cd D:\Repos\EGOS\Modules\egos-module-sdk
   npm install
   ```

2. **Use in your module with file path:**
   ```json
   // In your module's package.json
   {
     "dependencies": {
       "egos-module-sdk": "file:../egos-module-sdk"
     }
   }
   ```

3. **Install in your module:**
   ```bash
   cd D:\Repos\EGOS\Modules\YOUR-MODULE
   npm install
   ```

### Option 2: npm link (Alternative)

1. **Link the SDK globally:**
   ```bash
   cd D:\Repos\EGOS\Modules\egos-module-sdk
   npm link
   ```

2. **Link in your module:**
   ```bash
   cd D:\Repos\EGOS\Modules\YOUR-MODULE
   npm link egos-module-sdk
   ```

### Development Workflow

**Making changes to the SDK:**
1. Edit files in `egos-module-sdk/src/`
2. Changes are immediately available to modules using file path dependency
3. For npm link, changes are also immediate
4. Test changes in your module
5. Commit changes to SDK

**Adding new components:**
1. Create new component in appropriate directory
2. Export from `src/index.js`
3. Update version in `package.json`
4. Test in consuming module

## 📦 NPM Publishing Setup

### Preparing for NPM Publishing

1. **Update package.json:**
   ```json
   {
     "name": "egos-module-sdk",
     "version": "1.0.0",
     "description": "SDK for building EGOS hardware modules",
     "main": "src/index.js",
     "repository": {
       "type": "git",
       "url": "git+https://github.com/YOUR-ORG/egos-module-sdk.git"
     },
     "keywords": ["egos", "hardware", "iot", "module"],
     "license": "MIT"
   }
   ```

2. **Create .npmignore:**
   ```
   # Development files
   .git
   .idea
   *.log
   
   # Test files
   test/
   tests/
   __tests__/
   
   # Documentation (keep README.md)
   docs/
   examples/
   ```

3. **Add npm scripts:**
   ```json
   {
     "scripts": {
       "test": "echo \"Add tests here\"",
       "lint": "echo \"Add linting here\"",
       "prepublishOnly": "npm run test && npm run lint"
     }
   }
   ```

### Publishing to NPM

1. **Login to npm (first time only):**
   ```bash
   npm login
   ```

2. **Publish to npm:**
   ```bash
   cd D:\Repos\EGOS\Modules\egos-module-sdk
   
   # For first publish
   npm publish
   
   # For updates (increment version first)
   npm version patch  # or minor, major
   npm publish
   ```

3. **Publishing scoped packages (recommended):**
   ```bash
   # Update package.json name to "@your-org/egos-module-sdk"
   npm publish --access public
   ```

### Using Published Package

Once published to npm, modules can use it directly:

```json
{
  "dependencies": {
    "egos-module-sdk": "^1.0.0"
  }
}
```

```bash
npm install egos-module-sdk
```

## 🔧 Module Implementation

### Basic Module Structure

```javascript
const { logger, MQTTClient, RfidInput, QRInput } = require('egos-module-sdk');

class MyModule {
    constructor() {
        // MQTT client from SDK
        this.mqttClient = new MQTTClient({
            clientId: 'my-module-001',
            devices: [/* device config */]
        });

        // Input readers from SDK
        this.rfidReader = new RfidInput({
            onCode: (code) => this.handleRfidCode(code)
        });

        this.qrReader = new QRInput({
            port: '/dev/ttyS0',
            onCode: (code) => this.handleQrCode(code)
        });
    }

    async start() {
        await Promise.all([
            this.rfidReader.start(),
            this.qrReader.start()
        ]);
    }

    cleanup() {
        this.rfidReader.stop();
        this.qrReader.stop();
        this.mqttClient.cleanup();
    }
}
```

### Available Components

```javascript
const {
    // Base classes
    BaseInput,
    SerialInput, 
    PollingInput,
    
    // Specialized inputs
    RfidInput,
    QRInput,
    
    // Communication
    MQTTClient,
    
    // Utilities
    logger,
    createLogger
} = require('egos-module-sdk');
```

## 🧪 Testing Your Module

### With Local SDK (Development)

```bash
# Terminal 1: Your module
cd D:\Repos\EGOS\Modules\YOUR-MODULE
node module-qr-rfid.js

# Terminal 2: Monitor logs
tail -f logs/combined.log
```

### With Published SDK (Production)

```bash
# Install from npm
npm install egos-module-sdk

# Run your module
node module-qr-rfid.js
```

## 🔄 Version Management

### Semantic Versioning

- **Patch (1.0.1)**: Bug fixes, no breaking changes
- **Minor (1.1.0)**: New features, backward compatible
- **Major (2.0.0)**: Breaking changes

### Update Workflow

1. **Make changes to SDK**
2. **Update version:**
   ```bash
   cd egos-module-sdk
   npm version patch  # or minor/major
   ```
3. **Publish:**
   ```bash
   npm publish
   ```
4. **Update modules:**
   ```bash
   cd YOUR-MODULE
   npm update egos-module-sdk
   ```

## 🚦 Best Practices

### Development
- Use file path dependency during development
- Test thoroughly before publishing
- Keep breaking changes to major versions
- Document all public APIs

### Production
- Use specific versions in package.json (`"1.2.3"` not `"^1.2.3"`)
- Test updates in staging before production
- Monitor logs for SDK-related issues
- Keep SDK updated for security fixes

## 📋 Troubleshooting

### Common Issues

**"Cannot find module 'egos-module-sdk'":**
- Check package.json dependencies
- Run `npm install`
- Verify SDK path for file dependencies

**"Module version mismatch":**
- Update SDK: `npm update egos-module-sdk`
- Clear node_modules: `rm -rf node_modules && npm install`

**Permission errors during npm publish:**
- Check npm login: `npm whoami`
- Verify package name availability
- Use scoped packages: `@your-org/egos-module-sdk`

### Getting Help

1. Check SDK documentation
2. Review example implementations
3. Check GitHub issues
4. Contact the development team

## 🎯 Current Status

✅ **SDK Ready**: All components implemented and tested
✅ **Local Development**: File path dependency working
✅ **Module Migration**: QR/RFID module updated to use SDK
❌ **NPM Publishing**: Ready but not yet published
❌ **CI/CD**: Automated testing and publishing not set up

The SDK is fully functional for local development. Publishing to npm is optional and can be done when you're ready to share with other teams or deploy to production environments.
