const rpio = require('rpio');

class StepMotor {
    constructor({ pins }) {
        // Define pins
        this.pins = pins ?? [38, 36, 37, 35];

        // Initialize state tracking
        this._currentAngle = 0;
        this._isPowered = false;

        // Initialize pins
        for (let i = 0; i < this.pins.length; i++) {
            rpio.open(this.pins[i], rpio.OUTPUT, rpio.LOW);
        }

        // Define sequence patterns
        this.sequenceCW = [
            [1, 0, 0, 0],
            [1, 1, 0, 0],
            [0, 1, 0, 0],
            [0, 1, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 1, 1],
            [0, 0, 0, 1],
            [1, 0, 0, 1]
        ];

        this.sequenceCCW = [
            [1, 0, 0, 1],
            [0, 0, 0, 1],
            [0, 0, 1, 1],
            [0, 0, 1, 0],
            [0, 1, 1, 0],
            [0, 1, 0, 0],
            [1, 1, 0, 0],
            [1, 0, 0, 0]
        ];
    }

    /**
     * Get the current state of the motor
     * @returns {Object} Object containing current angle and power state
     */
    getState() {
        return {
            angle: this._currentAngle,
            power: this._isPowered
        };
    }

    async turn(angle) {
        // Calculate number of steps from angle
        const numSteps = Math.abs(angle) * 1.6;
        console.log("Turning steps: ", numSteps, angle);

        const sequence = angle > 0 ? this.sequenceCW : this.sequenceCCW;
        this._isPowered = true;

        try {
            for (let i = 0; i < numSteps; i++) {
                for (let j = 0; j < 8; j++) {
                    for (let k = 0; k < this.pins.length; k++) {
                        rpio.write(this.pins[k], sequence[j][k] ? rpio.HIGH : rpio.LOW);
                    }
                    rpio.msleep(1);
                }
            }
            // Update current angle after successful turn
            this._currentAngle = (this._currentAngle + angle) % 360;
            if (this._currentAngle < 0) {
                this._currentAngle += 360;  // Normalize negative angles
            }
        } finally {
            // Ensure pins are set to LOW even if an error occurs
            for (let k = 0; k < this.pins.length; k++) {
                rpio.write(this.pins[k], rpio.LOW);
            }
            this._isPowered = false;
        }
    }

    /**
     * Get the current angle of the motor
     * @returns {number} Current angle in degrees (0-359)
     */
    getCurrentAngle() {
        return this._currentAngle;
    }

    /**
     * Check if the motor is currently powered/turning
     * @returns {boolean} True if the motor is powered, false otherwise
     */
    isPowered() {
        return this._isPowered;
    }

    // Clean up method to properly close pins when done
    cleanup() {
        this._isPowered = false;
        for (let i = 0; i < this.pins.length; i++) {
            rpio.close(this.pins[i]);
        }
    }
}

module.exports = StepMotor;