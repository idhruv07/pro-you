# Mirror Project Flow

## User Journeys & Technical Sequence

### 1. Connection & Pairing Flow (Android 11+)
1. The user launches `MirrorLauncher.py` on macOS.
2. The user clicks **Wireless Pairing** and enters the IP, port, and 6-digit pairing code displayed on the Android device's Developer Options screen.
3. The receiver runs `adb pair <ip>:<port> <pairing_code>` in a background thread.
4. On success, the user adds the device to their list using the "+ Add Device" button.

### 2. Custom Video Stream Initialization
```
Android Sender                      macOS Receiver
--------------                      --------------
                                    Starts server.py (Listens on port 5001)
                                    Creates 'mirror_pipe' Named Pipe
                                    
Launches App & Enters IP
Taps "Toggle Mirror"
Requests MediaProjection Permissions
Acquires MediaProjection
Connects Socket to IP:5001 --------> Accept connection
Sends "MIRROR_START" --------------> Handshake received
                                    Spawns Socket -> Pipe Bridge Thread
                                    Opens pipe via OpenCV (blocks until stream)
Configures H.264 MediaCodec Encoder
Directs screen stream to Encoder
Reads encoded H.264 packets
Writes packets to TCP Stream ------> Writes packet bytes to Named Pipe
                                    OpenCV reads frames from Named Pipe
                                    Displays frames in GUI window ('Android Mirror')
```

### 3. Stream Termination Flow
- **Initiated by Android**: Tapping "Stop Mirroring" closes the socket connection. The receiver thread detects EOF, closes the named pipe, and OpenCV terminates the rendering window.
- **Initiated by Mac**: Closing the OpenCV window or pressing 'q' closes the named pipe. The bridge thread encounters a `BrokenPipeError` and closes the socket. The Android app receives a connection reset and stops the foreground service.
