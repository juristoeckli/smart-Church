# ESP32-C6-Zero web LED dimmer

Connect with USB power unplugged:

    GPIO4 → 330 ohm resistor → LED anode (long leg)
    GND   → LED cathode (short leg / flat side)

This is for a small external indicator LED, not the onboard addressable RGB LED.

1. Install Arduino IDE and the **esp32 by Espressif Systems** board package (3.3.5 or later).
2. Open `led_web.ino`. Select **Waveshare ESP32-C6-Zero**, your USB port, and **USB CDC On Boot: Enabled**.
3. Set `WIFI_SSID` and `WIFI_PASSWORD` in `wifi_secrets.h` to your existing **2.4 GHz Wi-Fi** name and password. This local file is excluded from Git. If it is missing, copy `wifi_secrets.example.h` to `wifi_secrets.h` first. Keep it in the same folder as the sketch when uploading.
4. Upload using a USB data cable. If necessary, hold BOOT, press and release RESET, then release BOOT and retry. Reset after upload.
5. Open Serial Monitor at **115200 baud**. After connecting, the ESP32 prints its web address, for example `http://192.168.1.123`.
6. Connect your phone or computer to the same local network and open that address in a browser. Set **Duty cycle (0–100%)** and **Frequency (200–20000 Hz)**, then click **Apply PWM settings**. Both controls use whole numbers. The confirmed values update after the ESP32 responds; polling does not overwrite unfinished edits.

The ESP32 joins your router as a Wi-Fi client and automatically reconnects after a dropout. It also retries unsuccessful connections every 30 seconds and does not create its own network. If it cannot connect, check the credentials and 2.4 GHz coverage. This is a local network control page with no HTTP authentication; use a trusted network. Guest-network client isolation can prevent browser access. A DHCP reservation in your router keeps the ESP32's address stable; if it changes, use the new address printed in Serial Monitor.

The page checks the ESP32 every second with a two-second request timeout. Green means a successful API response, not merely Wi-Fi connectivity. Red means the ESP32 did not respond; the slider disables and checks continue automatically. The page reports the duty cycle acknowledged by firmware, not a physical measurement of LED light. Browser background throttling may delay checks.

PWM uses GPIO4 with 8-bit resolution, starting at 5 kHz and 0% duty on boot. Frequency is adjustable from 200 Hz to 20 kHz; this range fits the 8-bit timer configuration with the default 40 MHz XTAL clock. The page displays the frequency reported by the timer, which may differ slightly from the requested value due to timer rounding. Duty is rounded to the available 8-bit steps. At 0% the LED is off; at 100% it stays on, so frequency has no visible effect at either endpoint. Losing the browser connection leaves the LED at its last setting. No Home Assistant or internet connection is required.

References:
- https://docs.waveshare.com/ESP32-C6-Zero
- https://docs.waveshare.com/ESP32-C6-Zero/Arduino
- https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html

Validation: browser JavaScript syntax and mocked status/apply/disconnection behavior checked. Firmware compilation and physical hardware testing still required.
