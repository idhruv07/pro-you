# GUI Dashboard for Multi-Device Mirroring

## Goal
Create a macOS GUI application (`MirrorLauncher.py`) that allows managing multiple Android devices for screen mirroring. It will persist device configurations and enable independent connections using `scrcpy`.

## Features
1.  **Device List**: Displays configured devices (Name + IP).
2.  **Add/Edit Device**: Dialog to add new devices (e.g., "Pixel 7 Pro", "192.168.1.50").
3.  **One-Click Connect**: Button to launch `scrcpy` for a specific device.
    - Handles `adb connect` automatically.
    - Checks for success before launching window.
4.  **Wireless Pairing (Zero Cable)**: Built-in flow to run `adb pair` with a code.
5.  **Multi-Instance Support**: Can run multiple mirroring windows simultaneously (e.g., OnePlus + Pixel).

## Technical Implementation
- **Language**: Python (`tkinter` for UI).
- **Persistence**: `devices.json` to store the device list.
- **Concurrency**: `subprocess` with `threading` to run ADB/scrcpy commands without freezing the GUI.
- **Dependencies**: Uses the existing `adb` and `scrcpy` installations.

## File Structure
- `MacReceiver/MirrorLauncher.py`: Main application.
- `MacReceiver/devices.json`: Configuration storage.

## Execution
User will run:
```bash
python3 MirrorLauncher.py
```
(Or I can wrap it in a `.command` file for double-click execution).
