// Components with safe loading - handles missing optional dependencies gracefully

// Input components (core dependencies)
const BaseInput = require('./input/BaseInput');
const SerialInput = require('./input/SerialInput');
const PollingInput = require('./input/PollingInput');
const Button = require('./input/Button');
const DigitalSensor = require('./input/DigitalSensor');

// Output components (core dependencies)
const LED = require('./output/LED');
const BidirectionalMotor = require('./output/BidirectionalMotor');
const StepMotor = require('./output/StepMotor');

// Components with optional dependencies - loaded conditionally
const components = {
    // Core components (always available)
    BaseInput,
    SerialInput,
    PollingInput,
    Button,
    DigitalSensor,
    LED,
    BidirectionalMotor,
    StepMotor
};

// Optional components - only load if dependencies are available
const optionalComponents = [
    { name: 'RfidInput', path: './input/RfidInput', deps: ['node-rfid'] },
    { name: 'QRInput', path: './input/QRInput', deps: [] },
    { name: 'MidiInput', path: './input/MidiInput', deps: ['easymidi'] },
    { name: 'Audio', path: './output/Audio', deps: ['uuid'] },
    { name: 'Video', path: './output/Video', deps: [] },
    { name: 'Touchscreen', path: './output/Touchscreen', deps: [] },
    { name: 'DMX', path: './output/DMX', deps: ['dmx'] },
    { name: 'MidiOutput', path: './output/MidiOutput', deps: ['easymidi'] },
    { name: 'Neopixel', path: './output/neopixel/Neopixel', deps: ['piixel'] },
    { name: 'NeopixelController', path: './output/neopixel/NeopixelController', deps: ['piixel'] },
    { name: 'AnimationManager', path: './output/neopixel/AnimationManager', deps: [] }
];

// Try to load optional components
optionalComponents.forEach(({ name, path, deps }) => {
    try {
        // Check if all dependencies are available
        deps.forEach(dep => require.resolve(dep));
        
        // If we get here, all deps are available, load the component
        components[name] = require(path);
        console.log(`✅ ${name} component loaded`);
    } catch (error) {
        // Component not available due to missing dependencies
        console.log(`⚠️  ${name} component skipped (missing dependencies: ${deps.join(', ')})`);
        
        // Create a stub that throws an informative error
        components[name] = class UnavailableComponent {
            constructor() {
                throw new Error(`${name} component is not available. Missing dependencies: ${deps.join(', ')}`);
            }
        };
    }
});

module.exports = components;
