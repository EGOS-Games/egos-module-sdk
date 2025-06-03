// Input components exports
const BaseInput = require('./input/BaseInput');
const SerialInput = require('./input/SerialInput');
const PollingInput = require('./input/PollingInput');
const RfidInput = require('./input/RfidInput');
const QRInput = require('./input/QRInput');
const Button = require('./input/Button');
const DigitalSensor = require('./input/DigitalSensor');
const MidiInput = require('./input/MidiInput');

// Output components exports
const LED = require('./output/LED');
const Audio = require('./output/Audio');
const Video = require('./output/Video');
const Touchscreen = require('./output/Touchscreen');
const DMX = require('./output/DMX');
const MidiOutput = require('./output/MidiOutput');
const BidirectionalMotor = require('./output/BidirectionalMotor');
const StepMotor = require('./output/StepMotor');

// Neopixel components
const Neopixel = require('./output/neopixel/Neopixel');
const NeopixelController = require('./output/neopixel/NeopixelController');
const AnimationManager = require('./output/neopixel/AnimationManager');

module.exports = {
    // Input components
    BaseInput,
    SerialInput,
    PollingInput,
    RfidInput,
    QRInput,
    Button,
    DigitalSensor,
    MidiInput,
    
    // Output components
    LED,
    Audio,
    Video,
    Touchscreen,
    DMX,
    MidiOutput,
    BidirectionalMotor,
    StepMotor,
    
    // Neopixel components
    Neopixel,
    NeopixelController,
    AnimationManager
};
