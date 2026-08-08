#!/usr/bin/env python3
"""
Mirror GUI - macOS Frontend for Android Screen Mirroring
A PyQt6-based application with device discovery and video display.
"""

import socket
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import cv2
import numpy as np
from PySide6.QtCore import Qt, QThread, Signal as pyqtSignal, QTimer
from PySide6.QtGui import QImage, QPixmap, QFont
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QListWidget, QListWidgetItem, QFrame,
    QProgressBar, QMessageBox, QSplitter
)


class NetworkScanner(QThread):
    """Scans local network for devices with open port 5001."""
    device_found = pyqtSignal(str)
    scan_finished = pyqtSignal()
    scan_progress = pyqtSignal(int)

    def __init__(self, subnet: str = "192.168.1"):
        super().__init__()
        self.subnet = subnet
        self._running = True

    def run(self):
        """Scan subnet for devices listening on port 5001."""
        def check_port(ip: str) -> Optional[str]:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.3)
                result = sock.connect_ex((ip, 5001))
                sock.close()
                if result == 0:
                    return ip
            except:
                pass
            return None

        with ThreadPoolExecutor(max_workers=50) as executor:
            ips = [f"{self.subnet}.{i}" for i in range(1, 255)]
            futures = {executor.submit(check_port, ip): ip for ip in ips}
            
            completed = 0
            for future in futures:
                if not self._running:
                    break
                result = future.result()
                if result:
                    self.device_found.emit(result)
                completed += 1
                self.scan_progress.emit(int(completed / 254 * 100))

        self.scan_finished.emit()

    def stop(self):
        self._running = False


class ConnectionHandler(QThread):
    """Handles a single device connection."""
    frame_ready = pyqtSignal(np.ndarray)
    disconnected = pyqtSignal(str)

    def __init__(self, conn: socket.socket, addr):
        super().__init__()
        self.conn = conn
        self.addr = addr
        self._running = True

    def run(self):
        ffmpeg_cmd = [
            'ffmpeg',
            '-f', 'h264',
            '-i', 'pipe:0',
            '-f', 'rawvideo',
            '-pix_fmt', 'bgr24',
            '-vsync', '0',
            '-an', '-sn',
            'pipe:1'
        ]

        ffmpeg_process = None
        try:
            ffmpeg_process = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=10**8
            )

            # Thread to read from socket and write to ffmpeg
            def socket_to_ffmpeg():
                try:
                    while self._running:
                        data = self.conn.recv(65536)
                        if not data:
                            break
                        ffmpeg_process.stdin.write(data)
                        ffmpeg_process.stdin.flush()
                except:
                    pass
                finally:
                    try:
                        ffmpeg_process.stdin.close()
                    except:
                        pass

            reader_thread = threading.Thread(target=socket_to_ffmpeg, daemon=True)
            reader_thread.start()

            # Read frames from ffmpeg
            width, height = 720, 1280
            frame_size = width * height * 3

            while self._running:
                raw_frame = ffmpeg_process.stdout.read(frame_size)
                if len(raw_frame) != frame_size:
                    break
                frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape((height, width, 3))
                self.frame_ready.emit(frame)

        except Exception as e:
            pass
        finally:
            self._running = False
            self.disconnected.emit(self.addr[0])
            if ffmpeg_process:
                try:
                    ffmpeg_process.terminate()
                except:
                    pass
            try:
                self.conn.close()
            except:
                pass

    def stop(self):
        self._running = False
        try:
            self.conn.close()
        except:
            pass


class VideoReceiver(QThread):
    """Listens for incoming connections."""
    new_connection = pyqtSignal(object, object) # socket, addr

    def __init__(self, port: int = 5001, udp_port: int = 5002):
        super().__init__()
        self.port = port
        self.udp_port = udp_port
        self._running = False
        self.server_socket: Optional[socket.socket] = None
        self.udp_socket: Optional[socket.socket] = None

    def run(self):
        self._running = True
        
        # Start UDP Discovery responder in a daemon thread
        def udp_responder():
            self.udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                self.udp_socket.bind(('0.0.0.0', self.udp_port))
                while self._running:
                    try:
                        self.udp_socket.settimeout(1.0)
                        data, addr = self.udp_socket.recvfrom(1024)
                        if data == b"DISCOVER_MIRROR_SERVER":
                            self.udp_socket.sendto(b"MIRROR_SERVER_OK", addr)
                    except socket.timeout:
                        continue
                    except:
                        break
            except:
                pass
            finally:
                if self.udp_socket:
                    try:
                        self.udp_socket.close()
                    except:
                        pass

        threading.Thread(target=udp_responder, daemon=True).start()

        try:
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind(('0.0.0.0', self.port))
            self.server_socket.listen(5) # Allow backlog
            self.server_socket.settimeout(1.0)

            while self._running:
                try:
                    conn, addr = self.server_socket.accept()
                    self.new_connection.emit(conn, addr)
                except socket.timeout:
                    continue
                except Exception as e:
                    break

        except Exception as e:
            pass
        finally:
            if self.server_socket:
                self.server_socket.close()

    def stop(self):
        self._running = False
        if self.server_socket:
            try:
                self.server_socket.close()
            except:
                pass
        if self.udp_socket:
            try:
                self.udp_socket.close()
            except:
                pass



class MirrorGUI(QMainWindow):
    """Main application window."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Android Mirror")
        self.setMinimumSize(400, 700)
        
        self.scanner: Optional[NetworkScanner] = None
        self.receiver: Optional[VideoReceiver] = None
        self.is_listening = False

        self._setup_ui()
        self._apply_styles()

    def _setup_ui(self):
        """Create the user interface."""
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setSpacing(12)
        layout.setContentsMargins(16, 16, 16, 16)

        # Header
        header = QLabel("📱 Android Mirror")
        header.setFont(QFont("SF Pro Display", 24, QFont.Weight.Bold))
        header.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(header)

        # Status indicator
        self.status_label = QLabel("● Disconnected")
        self.status_label.setObjectName("statusLabel")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.status_label)

        # Control buttons
        btn_layout = QHBoxLayout()
        
        self.btn_scan = QPushButton("🔍 Scan Network")
        self.btn_scan.clicked.connect(self._start_scan)
        btn_layout.addWidget(self.btn_scan)

        self.btn_listen = QPushButton("▶ Start Listening")
        self.btn_listen.clicked.connect(self._toggle_listening)
        btn_layout.addWidget(self.btn_listen)
        
        layout.addLayout(btn_layout)

        # Progress bar for scanning
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        layout.addWidget(self.progress_bar)

        # Device list
        list_label = QLabel("Discovered Devices:")
        list_label.setFont(QFont("SF Pro Display", 12))
        layout.addWidget(list_label)

        self.device_list = QListWidget()
        self.device_list.setMaximumHeight(120)
        layout.addWidget(self.device_list)

        # Video container
        self.video_container = QWidget()
        self.video_layout = QHBoxLayout(self.video_container) # Use HBox for 2 phones side-by-side
        self.video_layout.setContentsMargins(0, 0, 0, 0)
        
        # Placeholder for when no video
        self.empty_label = QLabel("Waiting for devices...")
        self.empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_label.setStyleSheet("color: #666; font-size: 16px;")
        self.video_layout.addWidget(self.empty_label)

        layout.addWidget(self.video_container, 1)

        # Info label
        self.info_label = QLabel("Tap 'Start Mirroring' on up to 2 devices")
        self.info_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.info_label.setWordWrap(True)
        layout.addWidget(self.info_label)

        self.active_handlers = {} # ip -> ConnectionHandler
        self.video_labels = {} # ip -> QLabel
        
    def _apply_styles(self):
        """Apply modern dark theme styling."""
        self.setStyleSheet("""
            QMainWindow {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                    stop:0 #1a1a2e, stop:1 #16213e);
            }
            QLabel {
                color: #eee;
            }
            #statusLabel {
                color: #ff6b6b;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #667eea, stop:1 #764ba2);
                color: white;
                border: none;
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #764ba2, stop:1 #667eea);
            }
            QPushButton:pressed {
                background: #5a5a8a;
            }
            QPushButton:disabled {
                background: #444;
                color: #888;
            }
            QListWidget {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: #ddd;
                padding: 8px;
            }
            QListWidget::item {
                padding: 8px;
                border-radius: 4px;
            }
            QListWidget::item:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            QListWidget::item:selected {
                background: rgba(102, 126, 234, 0.5);
            }
            QProgressBar {
                background: rgba(255, 255, 255, 0.1);
                border: none;
                border-radius: 4px;
                height: 8px;
            }
            QProgressBar::chunk {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #667eea, stop:1 #764ba2);
                border-radius: 4px;
            }
        """)

    def _start_scan(self):
        """Start scanning the network for devices."""
        self.device_list.clear()
        self.btn_scan.setEnabled(False)
        self.btn_scan.setText("Scanning...")
        self.progress_bar.setValue(0)
        self.progress_bar.setVisible(True)

        self.scanner = NetworkScanner()
        self.scanner.device_found.connect(self._on_device_found)
        self.scanner.scan_finished.connect(self._on_scan_finished)
        self.scanner.scan_progress.connect(self.progress_bar.setValue)
        self.scanner.start()

    def _on_device_found(self, ip: str):
        """Handle discovered device."""
        item = QListWidgetItem(f"📱 {ip}")
        self.device_list.addItem(item)

    def _on_scan_finished(self):
        """Handle scan completion."""
        self.btn_scan.setEnabled(True)
        self.btn_scan.setText("🔍 Scan Network")
        self.progress_bar.setVisible(False)
        
        if self.device_list.count() == 0:
            self.device_list.addItem("No devices found")

    def _toggle_listening(self):
        """Start or stop listening for connections."""
        if self.is_listening:
            self._stop_listening()
        else:
            self._start_listening()

    def _start_listening(self):
        """Start the video receiver server."""
        self.receiver = VideoReceiver()
        self.receiver.new_connection.connect(self._on_new_connection)
        self.receiver.start()

        self.is_listening = True
        self.btn_listen.setText("⏹ Stop Listening")
        self.status_label.setText("● Listening on port 5001...")
        self.status_label.setStyleSheet("color: #ffd93d;")
        self.info_label.setText("Listening... Open app on phone(s)")

    def _stop_listening(self):
        """Stop the video receiver and all active connections."""
        if self.receiver:
            self.receiver.stop()
            self.receiver.wait(500)
            self.receiver = None

        # Stop all handlers
        ip_list = list(self.active_handlers.keys())
        for ip in ip_list:
            self._on_device_disconnected(ip)

        self.is_listening = False
        self.btn_listen.setText("▶ Start Listening")
        self.status_label.setText("● Disconnected")
        self.status_label.setStyleSheet("color: #ff6b6b;")
        self.info_label.setText("Tap 'Start Mirroring' on up to 2 devices")

    def _on_new_connection(self, conn, addr):
        """Handle new incoming device connection."""
        ip = addr[0]
        if ip in self.active_handlers:
            return # Already connected

        # Create handler
        handler = ConnectionHandler(conn, addr)
        handler.frame_ready.connect(lambda frame, ip=ip: self._update_frame(ip, frame))
        handler.disconnected.connect(self._on_device_disconnected)
        
        self.active_handlers[ip] = handler
        handler.start()

        # Create UI
        self._add_device_ui(ip)
        self._update_status()

    def _add_device_ui(self, ip):
        """Add video widget for device."""
        self.empty_label.setVisible(False)
        
        # Container
        container = QFrame()
        container.setStyleSheet("background: #000; border: 2px solid #333; border-radius: 8px;")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # Label
        lbl_name = QLabel(f"📱 {ip}")
        lbl_name.setStyleSheet("color: #fff; background: rgba(0,0,0,0.5); padding: 4px;")
        lbl_name.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(lbl_name)
        
        # Video
        lbl_video = QLabel("Loading...")
        lbl_video.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lbl_video.setScaledContents(True)
        lbl_video.setSizePolicy(
            self.video_container.sizePolicy().horizontalPolicy(),
            self.video_container.sizePolicy().verticalPolicy()
        )
        layout.addWidget(lbl_video)
        
        self.video_layout.addWidget(container, 1)
        self.video_labels[ip] = lbl_video

    def _on_device_disconnected(self, ip):
        """Handle device disconnection."""
        if ip in self.active_handlers:
            self.active_handlers[ip].stop()
            del self.active_handlers[ip]
        
        # Remove UI
        # This is a bit tricky with dynamic layouts in Qt, easiest is to rebuild or hide
        # For simplicity, we'll maintain the list of labels and just rebuild the layout if needed
        # But here, we can iterate to find the widget. Note: In complex apps, use a custom widget class.
        
        # Force stop for now
        if ip in self.video_labels:
            # Simple clean: clear all and rebuild active ones (hacky but robust for small N)
            self._rebuild_video_layout()

        self._update_status()

    def _rebuild_video_layout(self):
        # Clear layout
        while self.video_layout.count():
            item = self.video_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        
        self.video_labels.clear()
        
        # Re-add empty label (hidden)
        self.empty_label = QLabel("Waiting for devices...")
        self.empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_label.setStyleSheet("color: #666; font-size: 16px;")
        self.video_layout.addWidget(self.empty_label)
        
        if not self.active_handlers:
            self.empty_label.setVisible(True)
        else:
            self.empty_label.setVisible(False)
            for ip in self.active_handlers:
                self._add_device_ui(ip)

    def _update_status(self):
        count = len(self.active_handlers)
        if count == 0:
            self.status_label.setText("● Listening... (0 devices)")
        else:
            self.status_label.setText(f"● Connected ({count} devices)")
            self.status_label.setStyleSheet("color: #6bcb77;")

    def _update_frame(self, ip: str, frame: np.ndarray):
        """Display a video frame for specific IP."""
        if ip not in self.video_labels:
            return
            
        lbl = self.video_labels[ip]
        
        h, w, ch = frame.shape
        bytes_per_line = ch * w
        qt_image = QImage(frame.data, w, h, bytes_per_line, QImage.Format.Format_BGR888)
        pixmap = QPixmap.fromImage(qt_image)
        
        # Determine scale target based on current label size
        # This might be small if 2 phones are side by side
        scaled = pixmap.scaled(
            lbl.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        lbl.setPixmap(scaled)

    def closeEvent(self, event):
        """Clean up on close."""
        self._stop_listening()
        if self.scanner:
            self.scanner.stop()
        event.accept()

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Android Mirror")
    
    window = MirrorGUI()
    window.show()
    
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
