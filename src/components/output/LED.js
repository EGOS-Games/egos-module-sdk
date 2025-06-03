const rpio = require('rpio');

class LED {
    constructor({ pin }) {
        this.pin = pin ?? 11;
        this.setupPin();
        this.blinkInterval = null;
        this.isBlinking = false;
    }

    setupPin() {
        rpio.open(this.pin, rpio.OUTPUT, rpio.LOW);
    }

    turnOn() {
        rpio.write(this.pin, rpio.HIGH);
    }

    turnOff() {
        rpio.write(this.pin, rpio.LOW);
    }

    set(value) {
        rpio.write(this.pin, value ? rpio.HIGH : rpio.LOW);
    }

    blink(ms) {
        // Stop any existing blink first
        this.stopBlink();

        // Start new blink interval
        this.isBlinking = true;
        let isOn = false;

        // Initial state
        rpio.write(this.pin, rpio.LOW);

        this.blinkInterval = setInterval(() => {
            if (!this.isBlinking) return;

            isOn = !isOn;
            rpio.write(this.pin, isOn ? rpio.HIGH : rpio.LOW);
        }, ms);
    }

    stopBlink() {
        if (this.blinkInterval) {
            clearInterval(this.blinkInterval);
            this.blinkInterval = null;
        }
        this.isBlinking = false;
        rpio.write(this.pin, rpio.LOW); // Ensure LED is off after stopping blink
    }

    cleanup() {
        this.stopBlink();
        rpio.close(this.pin);
    }
}

module.exports = LED;
