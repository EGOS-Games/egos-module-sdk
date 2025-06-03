const rpio = require("rpio");

class Button {
    constructor({ pin, onPress, onUnpress, debounceTime = 50 }) {
        this.pin = pin ?? 16;
        this.onPress = onPress;
        this.onUnpress = onUnpress;
        this.pressed = false;
        this.debounceTime = debounceTime;
        this.lastChangeTime = 0;
        this.setupPin();
    }

    setupPin() {
        rpio.open(this.pin, rpio.INPUT, rpio.PULL_UP);
    }

    pollCallback() {
        // Get current time for debouncing
        const now = Date.now();

        // Read the pin state (PULL_UP means 0 is pressed, 1 is released)
        const isReleased = rpio.read(this.pin);
        const isPressed = !isReleased;

        // Check if we should process this change (debounce)
        if (now - this.lastChangeTime < this.debounceTime) {
            return;
        }

        // Process button state changes
        if (isPressed && !this.pressed) {
            // Button was just pressed
            this.pressed = true;
            this.lastChangeTime = now;
            if (this.onPress) {
                this.onPress();
            }
        } else if (!isPressed && this.pressed) {
            // Button was just released
            this.pressed = false;
            this.lastChangeTime = now;
            if (this.onUnpress) {
                this.onUnpress();
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

module.exports = Button;
