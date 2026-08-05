# Walkthrough: How to Run the Mirroring App

This guide explains how to built and run the Android Sender and Mac Receiver.

## Prerequisites
- **Android Studio** installed.
- **Python 3** installed on your Mac.
- **FFmpeg** installed on your Mac (`brew install ffmpeg`).
- Both devices (Mac and Android Phone) must be on the **same Wi-Fi network**.

## Step 1: Start the Mac Receiver
1.  Open a terminal on your Mac.
2.  Navigate to the `MacReceiver` directory:
    ```bash
    cd "/Volumes/DJ EX OS/DJ External/.gemini/antigravity/scratch/Mirror/MacReceiver"
    ```
3.  Install Python dependencies:
    ```bash
    python3 -m pip install opencv-python numpy
    ```
4.  Run the server:
    ```bash
    python3 server.py
    ```
    *Note: You may need to accept a firewall popup.*

## Step 2: Connection Setup (Choose One)

### Option A: Wi-Fi (Easiest)
1.  In the terminal, run `ipconfig getifaddr en0` (or `en1` for Wi-Fi).
    -   Your current Wi-Fi IP is likely **192.168.1.18**.
2.  Enter THIS IP (`192.168.1.18`) in the Android App.
3.  Ensure both devices are on the same Wi-Fi.

### Option B: USB Cable (Fastest & Most Reliable)
If you want to use the USB cable and `127.0.0.1`:
1.  Make sure **USB Debugging** is on.
2.  Run this command in your Mac terminal:
    ```bash
    adb reverse tcp:5001 tcp:5001
    ```
3.  Now, in the Android App, enter: `127.0.0.1`
4.  This works for multiple devices if you run the command for each (or it applies to the connected one).

## Step 3: Run the Android App
1.  Open **Android Studio**.
2.  Select **Open** and choose the `Mirror/AndroidSender` folder.
3.  Connect your Android phone via USB and enable USB Debugging.
4.  Run the app (Green Play Button).
5.  On the phone:
    -   Enter the **Mac's IP Address** in the text field.
    -   Tap **Start Mirroring**.
    -   Accept the "Start recording or casting?" prompt.

## Step 4: Verify
-   The Mac terminal should say `Connection from: ...` and `Stream opened`.
-   A window named "Android Mirror" should appear on your Mac showing your phone screen.
