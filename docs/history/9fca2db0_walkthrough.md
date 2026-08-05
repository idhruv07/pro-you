# Wi-Fi Screen Mirroring Walkthrough

This guide explains how to use the newly created `run_scrcpy_wifi.sh` script to mirror your Android device screen to your Mac wirelessly using `scrcpy`.

## Pre-requisites
- **scrcpy** installed (`brew install scrcpy`)
- **adb** installed (`brew install android-platform-tools`)
- Android device and Mac connected to the **same Wi-Fi network**.

## Workflow
1. **Connect via USB (First Time Only)**:
   Connect your Android phone to your Mac using a USB cable. This is required to switch the device's ADB daemon to TCP/IP mode.

2. **Run the Script**:
   Execute the helper script in your terminal:
   ```bash
   ./run_scrcpy_wifi.sh
   ```

3. **Method A: Classic (USB First)**:
   - Connect via USB.
   - The script sets up TCP/IP, disconnects USB, and launches scrcpy.

4. **Method B: Wireless Debugging (No USB - Android 11+)**:
   - If no USB device is found, the script offers "Wireless Debugging".
   - Go to **Settings > Developer Options > Wireless Debugging**.
   - Select **Pair device with pairing code**.
   - Enter the displayed IP:Port and 6-digit Code into the script.
   - Enter the main connection IP:Port when prompted.

## Troubleshooting
- **"Device not found"**: Ensure USB debugging is enabled on your phone and you have trusted the Mac.
- **"Connection failed"**: Double-check that both devices are on the same Wi-Fi network. Some public/corporate Wi-Fi networks block device-to-device communication.
- **Lag/Latency**: Close other bandwidth-heavy apps. You can adjust the bitrate in the script (currently `4M`) if needed.
