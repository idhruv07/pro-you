# Mirror Project Architecture

## System Components

The screen mirroring application is divided into two primary subsystems:

```mermaid
graph TD
    subgraph Android Device (Sender)
        A[MainActivity] -->|Spawns| B[ScreenCaptureService]
        B -->|Acquires| C[MediaProjection]
        C -->|Feeds Surface| D[MediaCodec H.264 Encoder]
        D -->|Streams raw packets| E[TCP Socket Client]
    end

    subgraph macOS (Receiver)
        F[MirrorLauncher GUI] -->|ADB Commands| G[ADB Daemon / Server]
        H[Socket Server] -->|Bridges bytes| I[Named Pipe / FIFO]
        I -->|Reads Stream| J[OpenCV cv2.VideoCapture]
        J -->|Displays Window| K[cv2.imshow]
    end

    E -->|TCP Port 5001| H
    G -.->|ADB Wireless Control| A
```

### 1. Android Sender Application (`AndroidSender`)
- **UI (MainActivity)**: Simple input screen to enter the Mac's IP address and a toggle button to start/stop mirroring. It requests `MediaProjection` credentials from the Android OS.
- **Service (ScreenCaptureService)**: A foreground service that maintains active screen capture.
  - **MediaProjection**: Captures screen buffers.
  - **MediaCodec**: Encodes screen buffers to H.264 video streams in real-time.
  - **Network Client**: Connects via TCP to port `5001` on the macOS host and streams the encoded video packets.

### 2. macOS Receiver Application (`MacReceiver`)
- **Dashboard GUI (MirrorLauncher.py)**: Tkinter-based application that manages configured devices and uses subprocessing to pair (`adb pair`) or mirror (`scrcpy` / `mirror_fast.py`) over Wi-Fi.
- **Stream Receiver (server.py)**: A lightweight Python server that:
  - Listens on TCP port `5001` for raw video stream data.
  - Creates a POSIX Named Pipe (FIFO) at `mirror_pipe`.
  - Bridges the socket bytes directly into the pipe.
  - Opens the pipe using OpenCV's `VideoCapture` and renders the frame window in real-time.
