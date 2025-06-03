const rpio = require("rpio");

class DigitalSensor {
    constructor({ pin, valueChanged, debounceTime = 50 }) {
        this.pin = pin ?? 16;
        this.valueChanged = valueChanged;
        this.value = 0;
        this.debounceTime = debounceTime;
        this.lastChangeTime = 0;
        this.setupPin();
    }

    setupPin() {
        rpio.open(this.pin, rpio.INPUT, rpio.PULL_DOWN);
    }

    pollCallback() {
        // Get current time for debouncing
        const now = Date.now();

        const isPressed = rpio.read(this.pin);

        // Check if we should process this change (debounce)
        if (now - this.lastChangeTime < this.debounceTime) {
            return;
        }

        // Process button state changes
        if (isPressed && !this.value) {
            // Button was just pressed
            this.value = 1;
            this.lastChangeTime = now;
            if (this.valueChanged) {
                this.valueChanged(this.value);
            }
        } else if (!isPressed && this.value) {
            // Button was just released
            this.value = 0;
            this.lastChangeTime = now;
            if (this.valueChanged) {
                this.valueChanged(this.value);
            }
        }
    }

    poll() {
        // Set up polling with the correct callback binding
        rpio.poll(this.pin, this.pollCallback.bind(this), rpio.POLL_LOW);
    }

    manualPoll() {
        // For manual polling mode - call this periodically
        this.pollCallback();
    }

    cleanup() {
        // Properly clean up the pin
        try {
            rpio.poll(this.pin, null);
        } catch (e) {
            // Ignore errors when trying to unpoll
        }

        rpio.close(this.pin);
    }
}

module.exports = DigitalSensor;
