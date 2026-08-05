# Android Wi-Fi Screen Mirroring (Mirror)

## Description

The **Android Wi-Fi Screen Mirroring (Mirror)** project is a lightweight, low-latency cross-platform screen mirroring system. It is designed to cast an Android device's screen wirelessly to a macOS machine over a local area network (Wi-Fi).

### Key Features
- **Low Latency Casting**: Utilizes hardware-accelerated H.264 video encoding via Android's `MediaCodec` and streams raw bytes directly over TCP sockets.
- **Wireless Connection**: Supports traditional ADB over TCP/IP connection as well as modern Android 11+ Wireless Pairing (using pairing ports and 6-digit codes).
- **Custom macOS Viewer**: Features a desktop dashboard receiver implemented in Python using Tkinter and OpenCV (`cv2`).
- **Device Management**: Dynamically saves and manages multiple device configurations in a persistent local registry (`devices.json`).
- **Automated Setup**: Scripts automate the configuration of ADB, setting up TCP ports, and starting downstream mirror engines (like `scrcpy` fallback or custom OpenCV viewers).
