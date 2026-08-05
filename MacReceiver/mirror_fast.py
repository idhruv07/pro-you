#!/usr/bin/env python3
"""
Mirror Fast — macOS Frontend for Android Screen Mirroring
Uses OpenCV HighGUI for zero-dependency display and parses the v2 Framed Protocol.
"""

import socket
import subprocess
import sys
import threading
import struct
import time
from typing import Dict
import cv2
import numpy as np

# ── Configuration ─────────────────────────────────────────────────────────
PORT = 5001
DISCOVERY_PORT = 5002
FRAME_MAGIC = 0xDEADBEEF
FRAME_HEADER_SIZE = 8  # 4 bytes magic + 4 bytes length

# Map IP -> latest frame
active_feeds: Dict[str, np.ndarray] = {}
# Map IP -> connection status
connected_devices: Dict[str, bool] = {}


def get_local_ip() -> str:
    """Detect this Mac's real LAN/hotspot IP automatically."""
    try:
        # Connect to a public address without sending data — just to find the outbound IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def read_exact(conn, n: int) -> bytes | None:
    """Read exactly n bytes from a socket."""
    buf = b""
    try:
        while len(buf) < n:
            chunk = conn.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
    except Exception:
        return None
    return buf if len(buf) == n else None


def read_exact_from_pipe(stream, n: int) -> bytes | None:
    """Read exactly n bytes from a file-like stream (FFmpeg stdout)."""
    buf = b""
    try:
        while len(buf) < n:
            chunk = stream.read(n - len(buf))
            if not chunk:
                return None
            buf += chunk
    except Exception:
        return None
    return buf if len(buf) == n else None


def handle_client(conn, addr):
    """Handle a single client connection."""
    ip = addr[0]
    print(f"\n[+] New connection from {ip}")
    connected_devices[ip] = True

    ffmpeg_cmd = [
        'ffmpeg',
        '-loglevel', 'error',
        '-fflags', '+genpts+discardcorrupt',
        '-flags', '+low_delay',
        '-strict', 'experimental',
        '-f', 'h264',
        '-i', 'pipe:0',
        '-pix_fmt', 'bgr24',
        '-f', 'rawvideo',
        '-an', '-sn',
        'pipe:1'
    ]

    process = None
    try:
        # Step 1: Read handshake — exactly 12 bytes: "MIRROR_START"
        handshake = read_exact(conn, 12)
        if handshake != b"MIRROR_START":
            print(f"[{ip}] Error: invalid handshake: {handshake}")
            return

        print(f"[{ip}] Handshake OK. Starting FFmpeg decoder...")

        process = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=10**7
        )

        # Thread to log FFmpeg stderr output
        def log_stderr(handle):
            for line in iter(handle.readline, b''):
                if not line:
                    break
                print(f"[FFmpeg {ip}] {line.decode('utf-8', errors='ignore').strip()}")

        threading.Thread(target=log_stderr, args=(process.stderr,), daemon=True).start()

        # Thread: read framed data from socket → write raw payload to FFmpeg stdin
        def socket_reader():
            try:
                while connected_devices.get(ip):
                    # Read frame header: [4-byte magic][4-byte length]
                    header = read_exact(conn, FRAME_HEADER_SIZE)
                    if not header or len(header) < FRAME_HEADER_SIZE:
                        break

                    magic, length = struct.unpack(">II", header)
                    if magic != FRAME_MAGIC:
                        print(f"[{ip}] Warning: bad frame magic: {hex(magic)}")
                        break

                    if length <= 0 or length > 5_000_000:
                        print(f"[{ip}] Warning: invalid frame length: {length}")
                        break

                    # Read the actual video payload
                    payload = read_exact(conn, length)
                    if not payload:
                        break

                    process.stdin.write(payload)
                    process.stdin.flush()

            except Exception as e:
                print(f"[{ip}] Socket Reader Error: {e}")
            finally:
                try:
                    process.stdin.close()
                except Exception:
                    pass

        threading.Thread(target=socket_reader, daemon=True).start()

        # Android streams portrait 720x1280
        width, height = 720, 1280
        frame_size = width * height * 3  # bgr24 = 3 bytes per pixel

        while connected_devices.get(ip):
            raw_frame = read_exact_from_pipe(process.stdout, frame_size)
            if not raw_frame or len(raw_frame) != frame_size:
                break

            frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape((height, width, 3))
            active_feeds[ip] = frame

    except Exception as e:
        print(f"[-] Error with {ip}: {e}")
    finally:
        print(f"[-] Disconnected {ip}")
        connected_devices.pop(ip, None)
        active_feeds.pop(ip, None)
        if process:
            try:
                process.terminate()
            except Exception:
                pass
        try:
            conn.close()
        except Exception:
            pass
        cv2.destroyWindow(f"Mirror: {ip}")


def start_server():
    """Listen for incoming TCP connections."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', PORT))
    s.listen(5)
    print(f"[*] Listening on port {PORT}...")
    print("[*] Ready for connections! Tap 'Start Mirroring' on your phones.")

    while True:
        try:
            conn, addr = s.accept()
            t = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
            t.start()
        except Exception as e:
            print(f"Accept error: {e}")


def display_loop():
    """Main GUI loop using OpenCV (runs on the main thread)."""
    print("[*] Starting display loop (Press 'q' to quit)")

    while True:
        current_ips = list(active_feeds.keys())

        if not current_ips:
            # Show waiting window when no device is connected
            blank = np.zeros((200, 400, 3), dtype=np.uint8)
            cv2.putText(blank, "Waiting for connections...", (30, 100),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.imshow("Android Mirror Server", blank)
        else:
            # Close waiting window once a device appears
            try:
                if cv2.getWindowProperty("Android Mirror Server", 0) >= 0:
                    cv2.destroyWindow("Android Mirror Server")
            except Exception:
                pass

            # Show a window per connected device
            for ip in current_ips:
                if ip in active_feeds:
                    frame = active_feeds[ip]
                    # Display in portrait orientation
                    display_frame = cv2.resize(frame, (360, 640))
                    cv2.imshow(f"Mirror: {ip}", display_frame)

        key = cv2.waitKey(30) & 0xFF
        if key == ord('q'):
            print("Quitting...")
            break

    # Cleanup
    for ip in list(connected_devices.keys()):
        connected_devices[ip] = False
    cv2.destroyAllWindows()
    sys.exit(0)


def start_discovery_responder(my_ip: str, port: int = DISCOVERY_PORT):
    """Respond to UDP discovery broadcasts — reply includes this Mac's IP."""
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        udp_socket.bind(('0.0.0.0', port))
        print(f"[*] Discovery service on UDP {port} — my IP: {my_ip}")
        while True:
            data, addr = udp_socket.recvfrom(1024)
            if data == b"DISCOVER_MIRROR_SERVER":
                # Send back our IP so Android can auto-fill it
                reply = f"MIRROR_SERVER_OK:{my_ip}".encode()
                udp_socket.sendto(reply, addr)
                print(f"[+] Discovered by {addr[0]} — sent IP {my_ip}")
    except Exception as e:
        print(f"Discovery responder error: {e}")
    finally:
        udp_socket.close()


def start_ip_beacon(my_ip: str, port: int = DISCOVERY_PORT):
    """Periodically broadcast our presence so Android finds us without pressing Scan."""
    beacon_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    beacon_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    beacon_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    msg = f"MIRROR_SERVER_BEACON:{my_ip}:{PORT}".encode()
    try:
        while True:
            try:
                beacon_socket.sendto(msg, ('255.255.255.255', port))
            except Exception:
                pass
            time.sleep(3)  # beacon every 3 seconds
    finally:
        beacon_socket.close()


if __name__ == "__main__":
    # Detect this Mac's real IP
    MY_IP = get_local_ip()

    print("\n" + "═" * 50)
    print(f"  📱 Android Mirror Server  v2")
    print(f"  Mac IP  : {MY_IP}")
    print(f"  Port    : {PORT}")
    print(f"  On your phone — type: {MY_IP}")
    print(f"  OR tap 'Scan for Receivers' to auto-detect")
    print("═" * 50 + "\n")

    # Start UDP discovery responder (replies with our IP)
    threading.Thread(
        target=start_discovery_responder, args=(MY_IP,), daemon=True
    ).start()

    # Start IP beacon (broadcasts our presence every 3s)
    threading.Thread(
        target=start_ip_beacon, args=(MY_IP,), daemon=True
    ).start()

    # Start TCP server
    threading.Thread(target=start_server, daemon=True).start()

    # Run OpenCV display loop on main thread
    display_loop()
