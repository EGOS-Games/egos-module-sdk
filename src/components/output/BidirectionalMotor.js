const rpio = require("rpio");

class BidirectionalMotor {

    constructor({ pins }) {
        // Define pins
        this.pins = pins ?? [16, 18, 22];

        // Initialize state tracking
        this._isPowered = false;
        this._direction = null; // null when stopped, true for forward, false for reverse

        rpio.open(this.pins[0], rpio.OUTPUT, rpio.LOW);
        rpio.open(this.pins[1], rpio.OUTPUT, rpio.LOW);
        rpio.open(this.pins[2], rpio.OUTPUT, rpio.HIGH);
        rpio.write(this.pins[2], rpio.HIGH);
    }

    /**
     * Get the current state of the motor
     * @returns {Object} Object containing current power state and direction
     */
    getState() {
        return {
            power: this._isPowered,
            direction: this._direction,
        };
    }

    async start(direction) {
        rpio.write(this.pins[0], direction ? rpio.HIGH : rpio.LOW);
        rpio.write(this.pins[1], direction ? rpio.LOW : rpio.HIGH);

        // Update state
        this._isPowered = true;
        this._direction = direction;
    }

    async stop() {
        rpio.write(this.pins[0], rpio.LOW);
        rpio.write(this.pins[1], rpio.LOW);
        // Update state
        this._isPowered = false;
        this._direction = null;
    }

    /**
     * Check if the motor is currently powered
     * @returns {boolean} True if the motor is running, false otherwise
     */
    isPowered() {
        return this._isPowered;
    }

    /**
     * Get the current direction of the motor
     * @returns {boolean|null} true for forward, false for reverse, null if stopped
     */
    getDirection() {
        return this._direction;
    }

    // Clean up method to properly close pins when done
    cleanup() {
        this.stop();
        rpio.close(this.pins[0]);
        rpio.close(this.pins[1]);
        rpio.close(this.pins[2]);
        rpio.exit();
    }
}

module.exports = BidirectionalMotor;