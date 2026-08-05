# Implementation Plan - Android to Mac Mirroring

This plan outlines the creation of a local network screen mirroring application.

## User Review Required
> [!NOTE]
> **Receiver Technology**: I am proposing a **Python** script using OpenCV for the Mac receiver. This is the fastest way to get a working prototype. If you prefer a native macOS app (Swift) or another technology (Electron), please let me know.

## Proposed Changes

### Project Structure
- `AndroidSender/`: Native Android Studio Project.
- `MacReceiver/`: Python scripts for receiving and displaying the video.

### Android Sender (`AndroidSender/`)
#### [NEW] Android Project Files
- `app/src/main/java/.../MainActivity.kt`: UI to enter Mac IP and start service.
- `app/src/main/java/.../ScreenCaptureService.kt`: Background service handling `MediaProjection`.
- `app/src/main/java/.../TcpClient.kt`: Network socket handling.
- `app/src/main/java/.../VideoEncoder.kt`: Configures `MediaCodec` (H.264/AVC).
- `AndroidManifest.xml`: Permissions (INTERNET, FOREGROUND_SERVICE_MEDIA_PROJECTION).

### Mac Receiver (`MacReceiver/`)
#### [NEW] `server.py`
- TCP Server listening on port 5000 (default).
- Receives H.264 raw stream.
- Decodes using `cv2` (OpenCV) or `av` (PyAV).
- Displays in a window.

#### [NEW] `requirements.txt`
- `opencv-python`
- `numpy`

## Verification Plan

### Automated Tests
- None planned for the prototype phase (visual verification required).

### Manual Verification
1.  **Setup**:
    -   Run `python server.py` on Mac.
    -   Install and run Android App on device (or emulator, though screen capture might be black on some emulators).
    -   Ensure both are on the same Wi-Fi.
2.  **Connection**:
    -   Enter Mac IP in Android App.
    -   Click "Start Mirroring".
    -   Verify Mac terminal shows "Connected".
3.  **Streaming**:
    -   Verify Mac window opens and shows Android screen.
    -   Test latency by scrolling on phone.
    -   Test orientation changes.
