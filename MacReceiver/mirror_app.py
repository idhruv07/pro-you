#!/usr/bin/env python3
"""
Mirror Server — Professional macOS Desktop App
A premium PySide6 application for receiving and displaying Android screen mirroring streams.
"""

import sys
import socket
import struct
import threading
import time
from datetime import datetime

import cv2
import numpy as np

from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QFrame, QScrollArea, QSizePolicy,
    QFileDialog, QGraphicsDropShadowEffect
)
from PySide6.QtCore import (
    Qt, QThread, Signal, QTimer, QSize, QPropertyAnimation,
    QEasingCurve, QRect
)
from PySide6.QtGui import (
    QImage, QPixmap, QColor, QPalette, QFont, QFontDatabase,
    QPainter, QPen, QBrush, QLinearGradient, QIcon, QAction
)

# ─── Constants ──────────────────────────────────────────────────────────────
PORT_TCP = 5001
PORT_UDP = 5002
FRAME_MAGIC = 0xDEADBEEF
FRAME_HEADER_SIZE = 8  # 4 magic + 4 length

# ─── Color Palette ──────────────────────────────────────────────────────────
BG_DARK       = "#0F172A"
BG_CARD       = "#1E293B"
BG_SIDEBAR    = "#0D1526"
BORDER        = "#1E3A5F"
ACCENT_BLUE   = "#3B82F6"
ACCENT_GREEN  = "#10B981"
ACCENT_RED    = "#EF4444"
ACCENT_AMBER  = "#F59E0B"
TEXT_PRIMARY  = "#F1F5F9"
TEXT_MUTED    = "#64748B"
TEXT_DIM      = "#334155"


# ═══════════════════════════════════════════════════════════════════════════
# WORKER THREADS
# ═══════════════════════════════════════════════════════════════════════════

class StreamWorker(QThread):
    """Receives, decodes, and emits H.264 video frames from a connected phone."""
    frame_ready   = Signal(str, np.ndarray)   # (ip, frame)
    device_connected    = Signal(str)          # ip
    device_disconnected = Signal(str)          # ip
    stats_updated = Signal(str, dict)          # (ip, stats dict)
    log_message   = Signal(str, str)           # (level, message)

    def __init__(self, conn: socket.socket, addr):
        super().__init__()
        self.conn = conn
        self.addr = addr
        self.ip = addr[0]
        self._running = True

    def run(self):
        self.log_message.emit("info", f"New connection from {self.ip}")

        try:
            # Read and validate handshake (exactly 12 bytes: "MIRROR_START")
            handshake = self._read_exact(12)
            if handshake != b"MIRROR_START":
                self.log_message.emit("warn", f"[{self.ip}] Bad handshake: {handshake[:20]}")
                return

            self.log_message.emit("info", f"[{self.ip}] Handshake OK — starting decoder")
            self.device_connected.emit(self.ip)

            # Setup FFmpeg decoder process
            import subprocess
            ffmpeg_cmd = [
                "ffmpeg",
                "-loglevel", "error",
                "-fflags", "+genpts+discardcorrupt",
                "-flags", "+low_delay",
                "-f", "h264",
                "-i", "pipe:0",
                "-pix_fmt", "bgr24",
                "-f", "rawvideo",
                "-an", "-sn",
                "pipe:1"
            ]

            proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=10**7
            )

            # Stats tracking
            frame_count = 0
            bytes_received = 0
            last_stats_time = time.time()
            width = height = 0

            # Read framed data → pipe to FFmpeg → read decoded frames
            def pipe_to_ffmpeg():
                nonlocal bytes_received
                try:
                    while self._running:
                        header = self._read_exact(FRAME_HEADER_SIZE)
                        if not header or len(header) < FRAME_HEADER_SIZE:
                            break

                        magic, length = struct.unpack(">II", header)
                        if magic != FRAME_MAGIC:
                            self.log_message.emit("warn", f"[{self.ip}] Bad magic: {hex(magic)}")
                            break

                        if length <= 0 or length > 5_000_000:
                            self.log_message.emit("warn", f"[{self.ip}] Bad frame length: {length}")
                            break

                        payload = self._read_exact(length)
                        if not payload:
                            break

                        bytes_received += length
                        proc.stdin.write(payload)
                        proc.stdin.flush()

                except Exception as e:
                    self.log_message.emit("error", f"[{self.ip}] Reader: {e}")
                finally:
                    try:
                        proc.stdin.close()
                    except:
                        pass

            reader_thread = threading.Thread(target=pipe_to_ffmpeg, daemon=True)
            reader_thread.start()

            # Android streams portrait 720x1280
            INITIAL_WIDTH, INITIAL_HEIGHT = 720, 1280
            w, h = INITIAL_WIDTH, INITIAL_HEIGHT
            frame_size = w * h * 3  # bgr24

            while self._running:
                raw = self._read_exact_from(proc.stdout, frame_size)
                if raw is None or len(raw) != frame_size:
                    break

                frame = np.frombuffer(raw, dtype=np.uint8).reshape((h, w, 3))
                self.frame_ready.emit(self.ip, frame.copy())

                frame_count += 1
                now = time.time()
                if now - last_stats_time >= 1.0:
                    fps = frame_count / (now - last_stats_time)
                    mbps = (bytes_received * 8) / (now - last_stats_time) / 1_000_000
                    self.stats_updated.emit(self.ip, {
                        "fps": fps,
                        "mbps": mbps,
                        "resolution": f"{w}×{h}",
                    })
                    frame_count = 0
                    bytes_received = 0
                    last_stats_time = now

        except Exception as e:
            self.log_message.emit("error", f"[{self.ip}] Stream error: {e}")
        finally:
            self._running = False
            try:
                self.conn.close()
            except:
                pass
            self.device_disconnected.emit(self.ip)
            self.log_message.emit("info", f"[{self.ip}] Disconnected")

    def _read_exact(self, n: int) -> bytes | None:
        """Read exactly n bytes from the client socket."""
        buf = b""
        try:
            while len(buf) < n and self._running:
                chunk = self.conn.recv(n - len(buf))
                if not chunk:
                    return None
                buf += chunk
        except:
            return None
        return buf if len(buf) == n else None

    def _read_exact_from(self, fp, n: int) -> bytes | None:
        """Read exactly n bytes from a file-like object (FFmpeg stdout)."""
        buf = b""
        try:
            while len(buf) < n:
                chunk = fp.read(n - len(buf))
                if not chunk:
                    return None
                buf += chunk
        except:
            return None
        return buf

    def stop(self):
        self._running = False
        try:
            self.conn.close()
        except:
            pass


class ServerWorker(QThread):
    """Listens for incoming TCP connections and spawns StreamWorkers."""
    new_client = Signal(object, tuple)   # (conn, addr)
    log_message = Signal(str, str)

    def __init__(self, port=PORT_TCP):
        super().__init__()
        self.port = port
        self._running = True
        self._server_sock = None

    def run(self):
        self._server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server_sock.bind(("0.0.0.0", self.port))
        self._server_sock.listen(5)
        self._server_sock.settimeout(1.0)
        self.log_message.emit("info", f"TCP server listening on port {self.port}")

        while self._running:
            try:
                conn, addr = self._server_sock.accept()
                self.new_client.emit(conn, addr)
            except socket.timeout:
                continue
            except Exception as e:
                if self._running:
                    self.log_message.emit("error", f"Accept error: {e}")

    def stop(self):
        self._running = False
        try:
            self._server_sock.close()
        except:
            pass


def get_local_ip() -> str:
    """Detect this Mac's real LAN/hotspot IP automatically."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


class IPBeaconWorker(QThread):
    """Periodically broadcasts this Mac's IP so Android client auto-discovers it."""
    def __init__(self, my_ip: str, port: int = PORT_UDP):
        super().__init__()
        self.my_ip = my_ip
        self.port = port
        self._running = True

    def run(self):
        beacon_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        beacon_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        beacon_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        msg = f"MIRROR_SERVER_BEACON:{self.my_ip}:{PORT_TCP}".encode()
        while self._running:
            try:
                beacon_socket.sendto(msg, ('255.255.255.255', self.port))
            except Exception:
                pass
            time.sleep(3)
        beacon_socket.close()

    def stop(self):
        self._running = False


class DiscoveryWorker(QThread):
    """Responds to UDP discovery broadcasts from Android clients."""
    client_discovered = Signal(str)
    log_message = Signal(str, str)

    def __init__(self, my_ip: str, port=PORT_UDP):
        super().__init__()
        self.my_ip = my_ip
        self.port = port
        self._running = True

    def run(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", self.port))
        sock.settimeout(1.0)
        self.log_message.emit("info", f"UDP discovery listening on port {self.port}")

        while self._running:
            try:
                data, addr = sock.recvfrom(1024)
                if data == b"DISCOVER_MIRROR_SERVER":
                    reply = f"MIRROR_SERVER_OK:{self.my_ip}".encode()
                    sock.sendto(reply, addr)
                    self.log_message.emit("info", f"Discovered by {addr[0]} — sent IP {self.my_ip}")
                    self.client_discovered.emit(addr[0])
            except socket.timeout:
                continue
            except Exception as e:
                if self._running:
                    self.log_message.emit("error", f"Discovery error: {e}")

        sock.close()

    def stop(self):
        self._running = False


# ═══════════════════════════════════════════════════════════════════════════
# UI COMPONENTS
# ═══════════════════════════════════════════════════════════════════════════

class PulsingDot(QWidget):
    """Animated status indicator dot."""
    def __init__(self, color: str = ACCENT_GREEN, parent=None):
        super().__init__(parent)
        self.color = QColor(color)
        self._alpha = 255
        self._growing = False
        self.setFixedSize(12, 12)

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._pulse)
        self._timer.start(40)

    def _pulse(self):
        step = 8
        if self._growing:
            self._alpha = min(255, self._alpha + step)
            if self._alpha >= 255:
                self._growing = False
        else:
            self._alpha = max(60, self._alpha - step)
            if self._alpha <= 60:
                self._growing = True
        self.update()

    def set_color(self, color: str):
        self.color = QColor(color)
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        c = QColor(self.color)
        c.setAlpha(self._alpha)
        painter.setBrush(QBrush(c))
        painter.setPen(Qt.NoPen)
        painter.drawEllipse(1, 1, 10, 10)


class DeviceCard(QFrame):
    """A card in the sidebar representing one connected device."""
    def __init__(self, ip: str, parent=None):
        super().__init__(parent)
        self.ip = ip
        self.setStyleSheet(f"""
            QFrame {{
                background: {BG_CARD};
                border: 1px solid {BORDER};
                border-radius: 10px;
                padding: 10px;
            }}
        """)
        self.setFixedHeight(90)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(4)

        # Top row: dot + IP
        top_row = QHBoxLayout()
        self.dot = PulsingDot(ACCENT_GREEN)
        self.lbl_ip = QLabel(f"📱  {ip}")
        self.lbl_ip.setStyleSheet(f"color: {TEXT_PRIMARY}; font-size: 13px; font-weight: 600;")
        top_row.addWidget(self.dot)
        top_row.addWidget(self.lbl_ip)
        top_row.addStretch()

        # Stats
        self.lbl_fps = QLabel("-- fps")
        self.lbl_fps.setStyleSheet(f"color: {ACCENT_BLUE}; font-size: 11px;")
        self.lbl_res = QLabel("--")
        self.lbl_res.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 11px;")
        self.lbl_mbps = QLabel("-- Mbps")
        self.lbl_mbps.setStyleSheet(f"color: {ACCENT_AMBER}; font-size: 11px;")

        stats_row = QHBoxLayout()
        stats_row.addWidget(self.lbl_fps)
        stats_row.addWidget(self.lbl_res)
        stats_row.addWidget(self.lbl_mbps)
        stats_row.addStretch()

        layout.addLayout(top_row)
        layout.addLayout(stats_row)

    def update_stats(self, stats: dict):
        self.lbl_fps.setText(f"{stats.get('fps', 0):.1f} fps")
        self.lbl_res.setText(stats.get("resolution", "--"))
        self.lbl_mbps.setText(f"{stats.get('mbps', 0):.2f} Mbps")

    def set_disconnected(self):
        self.dot.set_color(ACCENT_RED)
        self.lbl_ip.setText(f"💤  {self.ip}")
        self.lbl_fps.setText("Disconnected")


class VideoCanvas(QLabel):
    """High-performance video display area."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAlignment(Qt.AlignCenter)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMinimumSize(640, 360)
        self._show_placeholder()

    def _show_placeholder(self):
        placeholder = QPixmap(800, 450)
        placeholder.fill(QColor(BG_DARK))

        painter = QPainter(placeholder)
        painter.setRenderHint(QPainter.Antialiasing)

        # Subtle grid lines
        pen = QPen(QColor(BORDER))
        pen.setWidth(1)
        painter.setPen(pen)
        for x in range(0, 800, 40):
            painter.drawLine(x, 0, x, 450)
        for y in range(0, 450, 40):
            painter.drawLine(0, y, 800, y)

        # Center icon text
        painter.setPen(QColor(TEXT_DIM))
        font = QFont("SF Pro Display", 48)
        painter.setFont(font)
        painter.drawText(placeholder.rect(), Qt.AlignCenter, "📱")

        font2 = QFont("SF Pro Display", 16)
        painter.setFont(font2)
        painter.setPen(QColor(TEXT_MUTED))
        painter.drawText(QRect(0, 280, 800, 40), Qt.AlignCenter, "Waiting for device connection...")

        font3 = QFont("SF Pro Display", 12)
        painter.setFont(font3)
        painter.setPen(QColor(TEXT_DIM))
        painter.drawText(QRect(0, 320, 800, 40), Qt.AlignCenter, "Open Mirror app on your Android phone and tap Start Mirroring")

        painter.end()
        self.setPixmap(placeholder)

    def update_frame(self, frame: np.ndarray):
        h, w, ch = frame.shape
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = QImage(rgb.data, w, h, ch * w, QImage.Format_RGB888)
        pix = QPixmap.fromImage(img)
        scaled = pix.scaled(self.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        self.setPixmap(scaled)

    def get_current_frame(self) -> np.ndarray | None:
        pix = self.pixmap()
        if pix and not pix.isNull():
            img = pix.toImage()
            img = img.convertToFormat(QImage.Format_RGB888)
            w, h = img.width(), img.height()
            ptr = img.bits()
            arr = np.frombuffer(ptr, dtype=np.uint8).reshape((h, w, 3))
            return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        return None


class LogEntry(QLabel):
    """A single log entry widget."""
    COLORS = {
        "info":  TEXT_MUTED,
        "warn":  ACCENT_AMBER,
        "error": ACCENT_RED,
        "ok":    ACCENT_GREEN,
    }

    def __init__(self, level: str, message: str, parent=None):
        super().__init__(parent)
        ts = datetime.now().strftime("%H:%M:%S")
        icons = {"info": "ℹ", "warn": "⚠", "error": "✖", "ok": "✔"}
        icon = icons.get(level, "·")
        color = self.COLORS.get(level, TEXT_MUTED)
        self.setText(f'<span style="color:{TEXT_DIM}">{ts}</span> '
                     f'<span style="color:{color}">{icon} {message}</span>')
        self.setStyleSheet("font-family: monospace; font-size: 11px; padding: 2px 0;")
        self.setWordWrap(True)


# ═══════════════════════════════════════════════════════════════════════════
# MAIN WINDOW
# ═══════════════════════════════════════════════════════════════════════════

class MirrorWindow(QMainWindow):
    def __init__(self, title="Mirror Server"):
        super().__init__()
        self.setWindowTitle(f"{title} — Android Screen Mirroring")
        self.setMinimumSize(1100, 700)
        self.resize(1280, 800)

        self._stream_workers: dict[str, StreamWorker] = {}
        self._device_cards:   dict[str, DeviceCard]   = {}
        self._video_canvases:  dict[str, VideoCanvas]  = {}
        self._current_ip:     str | None               = None

        self._apply_dark_theme()
        self._build_ui()
        self._start_services()

    # ── Theme ──────────────────────────────────────────────────────────────

    def _apply_dark_theme(self):
        self.setStyleSheet(f"""
            QMainWindow, QWidget {{
                background-color: {BG_DARK};
                color: {TEXT_PRIMARY};
                font-family: "SF Pro Display", "Segoe UI", Arial, sans-serif;
            }}
            QScrollArea {{ border: none; background: transparent; }}
            QScrollBar:vertical {{
                background: {BG_CARD}; width: 6px; border-radius: 3px;
            }}
            QScrollBar::handle:vertical {{
                background: {BORDER}; border-radius: 3px;
            }}
            QPushButton {{
                background: {BG_CARD};
                color: {TEXT_PRIMARY};
                border: 1px solid {BORDER};
                border-radius: 8px;
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 500;
            }}
            QPushButton:hover {{ background: {ACCENT_BLUE}; border-color: {ACCENT_BLUE}; }}
            QPushButton:pressed {{ background: #2563EB; }}
            QLabel {{ color: {TEXT_PRIMARY}; }}
        """)

    # ── Build UI ───────────────────────────────────────────────────────────

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── Toolbar ──
        root.addWidget(self._build_toolbar())

        # ── Main area (sidebar + video) ──
        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)
        body.addWidget(self._build_sidebar())
        body.addWidget(self._build_video_area(), stretch=1)

        body_widget = QWidget()
        body_widget.setLayout(body)
        root.addWidget(body_widget, stretch=1)

        # ── Status bar ──
        root.addWidget(self._build_statusbar())

    def _build_toolbar(self) -> QWidget:
        bar = QFrame()
        bar.setFixedHeight(56)
        bar.setStyleSheet(f"""
            QFrame {{
                background: {BG_CARD};
                border-bottom: 1px solid {BORDER};
            }}
        """)
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(20, 0, 20, 0)

        # Logo
        logo = QLabel("🪞  Mirror Server")
        logo.setStyleSheet(f"color: {TEXT_PRIMARY}; font-size: 18px; font-weight: 700; letter-spacing: -0.3px;")
        layout.addWidget(logo)

        badge = QLabel("v2 · Wi-Fi")
        badge.setStyleSheet(f"""
            background: {ACCENT_BLUE}22;
            color: {ACCENT_BLUE};
            border: 1px solid {ACCENT_BLUE}44;
            border-radius: 10px;
            padding: 2px 10px;
            font-size: 11px;
            font-weight: 600;
        """)
        layout.addWidget(badge)
        layout.addStretch()

        # Buttons
        self.btn_dashboard = QPushButton("🌐  Web Dashboard")
        self.btn_dashboard.clicked.connect(self._open_dashboard)
        self.btn_dashboard.setStyleSheet(self.btn_dashboard.styleSheet())

        self.btn_screenshot = QPushButton("📸  Screenshot")
        self.btn_screenshot.clicked.connect(self._take_screenshot)
        self.btn_screenshot.setStyleSheet(self.btn_screenshot.styleSheet())

        self.btn_fullscreen = QPushButton("⛶  Fullscreen")
        self.btn_fullscreen.clicked.connect(self._toggle_fullscreen)

        for btn in [self.btn_dashboard, self.btn_screenshot, self.btn_fullscreen]:
            btn.setFixedHeight(36)
            layout.addWidget(btn)

        return bar

    def _build_sidebar(self) -> QWidget:
        sidebar = QFrame()
        sidebar.setFixedWidth(220)
        sidebar.setStyleSheet(f"""
            QFrame {{
                background: {BG_SIDEBAR};
                border-right: 1px solid {BORDER};
            }}
        """)
        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(12, 16, 12, 12)
        layout.setSpacing(12)

        # Section: Devices
        dev_label = QLabel("CONNECTED DEVICES")
        dev_label.setStyleSheet(f"color: {TEXT_DIM}; font-size: 10px; font-weight: 700; letter-spacing: 1px;")
        layout.addWidget(dev_label)

        self.device_area = QVBoxLayout()
        self.device_area.setSpacing(8)
        self.no_device_label = QLabel("No devices yet.\nOpen Mirror app on your phone.")
        self.no_device_label.setStyleSheet(f"color: {TEXT_DIM}; font-size: 12px;")
        self.no_device_label.setAlignment(Qt.AlignCenter)
        self.no_device_label.setWordWrap(True)
        self.device_area.addWidget(self.no_device_label)

        device_widget = QWidget()
        device_widget.setLayout(self.device_area)
        layout.addWidget(device_widget)

        layout.addStretch()

        # Section: Activity Log
        log_label = QLabel("ACTIVITY LOG")
        log_label.setStyleSheet(f"color: {TEXT_DIM}; font-size: 10px; font-weight: 700; letter-spacing: 1px;")
        layout.addWidget(log_label)

        self.log_scroll = QScrollArea()
        self.log_scroll.setWidgetResizable(True)
        self.log_scroll.setFixedHeight(200)
        self.log_scroll.setStyleSheet(f"""
            QScrollArea {{
                background: {BG_DARK};
                border: 1px solid {BORDER};
                border-radius: 8px;
            }}
        """)
        self.log_container = QWidget()
        self.log_layout = QVBoxLayout(self.log_container)
        self.log_layout.setContentsMargins(8, 8, 8, 8)
        self.log_layout.setSpacing(2)
        self.log_layout.addStretch()
        self.log_scroll.setWidget(self.log_container)
        layout.addWidget(self.log_scroll)

        return sidebar

    def _show_video_placeholder(self):
        placeholder = QPixmap(800, 450)
        placeholder.fill(QColor(BG_DARK))

        painter = QPainter(placeholder)
        painter.setRenderHint(QPainter.Antialiasing)

        # Subtle grid lines
        pen = QPen(QColor(BORDER))
        pen.setWidth(1)
        painter.setPen(pen)
        for x in range(0, 800, 40):
            painter.drawLine(x, 0, x, 450)
        for y in range(0, 450, 40):
            painter.drawLine(0, y, 800, y)

        # Center icon text
        painter.setPen(QColor(TEXT_DIM))
        font = QFont("SF Pro Display", 48)
        painter.setFont(font)
        painter.drawText(placeholder.rect(), Qt.AlignCenter, "📱")

        font2 = QFont("SF Pro Display", 16)
        painter.setFont(font2)
        painter.setPen(QColor(TEXT_MUTED))
        painter.drawText(QRect(0, 280, 800, 40), Qt.AlignCenter, "Waiting for device connection...")

        font3 = QFont("SF Pro Display", 12)
        painter.setFont(font3)
        painter.setPen(QColor(TEXT_DIM))
        painter.drawText(QRect(0, 320, 800, 40), Qt.AlignCenter, "Open Mirror app on your Android phone and tap Start Mirroring")

        painter.end()
        self.placeholder_label.setPixmap(placeholder)
        self.placeholder_label.show()

    def _build_video_area(self) -> QWidget:
        self.video_area_widget = QFrame()
        self.video_area_widget.setStyleSheet(f"background: {BG_DARK};")
        
        # Horizontal layout for multiple streams side-by-side
        self.video_layout = QHBoxLayout(self.video_area_widget)
        self.video_layout.setContentsMargins(10, 10, 10, 10)
        self.video_layout.setSpacing(15)

        # Placeholder label
        self.placeholder_label = QLabel()
        self.placeholder_label.setAlignment(Qt.AlignCenter)
        self.video_layout.addWidget(self.placeholder_label)
        self._show_video_placeholder()

        return self.video_area_widget

    def _build_statusbar(self) -> QWidget:
        bar = QFrame()
        bar.setFixedHeight(38)
        bar.setStyleSheet(f"""
            QFrame {{
                background: {BG_CARD};
                border-top: 1px solid {BORDER};
            }}
        """)
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(20, 0, 20, 0)

        self.status_dot = PulsingDot(TEXT_DIM)
        self.status_dot.set_color(TEXT_DIM)
        layout.addWidget(self.status_dot)

        self.status_label = QLabel("Waiting for connections…")
        self.status_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 12px;")
        layout.addWidget(self.status_label)

        layout.addStretch()

        self.lbl_fps   = QLabel()
        self.lbl_res   = QLabel()
        self.lbl_mbps  = QLabel()
        for lbl in [self.lbl_fps, self.lbl_res, self.lbl_mbps]:
            lbl.setStyleSheet(f"color: {TEXT_DIM}; font-size: 12px; font-family: monospace;")
            layout.addWidget(lbl)
            layout.addSpacing(16)

        return bar

    # ── Services ───────────────────────────────────────────────────────────

    def _start_services(self):
        my_ip = get_local_ip()

        # Start FastAPI backend
        import subprocess
        import os
        cwd = os.path.dirname(os.path.abspath(__file__))
        server_dir = os.path.join(cwd, "server")
        venv_python = os.path.join(server_dir, "venv", "bin", "python3")
        python_exe = venv_python if os.path.exists(venv_python) else "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
        self.backend_process = subprocess.Popen(
            [python_exe, "-m", "uvicorn", "main:app", "--port", "8080"],
            cwd=server_dir
        )
        self._on_log("ok", "Started Web Dashboard backend on port 8080")

        # TCP server
        self.server = ServerWorker(PORT_TCP)
        self.server.new_client.connect(self._on_new_client)
        self.server.log_message.connect(self._on_log)
        self.server.start()

        # UDP discovery
        self.discovery = DiscoveryWorker(my_ip, PORT_UDP)
        self.discovery.client_discovered.connect(
            lambda ip: self._on_log("info", f"Auto-discovered by {ip}")
        )
        self.discovery.log_message.connect(self._on_log)
        self.discovery.start()

        # IP Beacon
        self.beacon = IPBeaconWorker(my_ip, PORT_UDP)
        self.beacon.start()

        self._on_log("ok", f"Mirror Server v2 active at {my_ip} — ready for connections")

    # ── Slots ──────────────────────────────────────────────────────────────

    def _on_new_client(self, conn, addr):
        ip = addr[0]
        worker = StreamWorker(conn, addr)
        worker.frame_ready.connect(self._on_frame)
        worker.device_connected.connect(self._on_device_connected)
        worker.device_disconnected.connect(self._on_device_disconnected)
        worker.stats_updated.connect(self._on_stats)
        worker.log_message.connect(self._on_log)
        self._stream_workers[ip] = worker
        worker.start()

    def _on_device_connected(self, ip: str):
        if ip in self._device_cards:
            return
        # Hide placeholders
        self.no_device_label.hide()
        self.placeholder_label.hide()

        # Create sidebar card
        card = DeviceCard(ip)
        self._device_cards[ip] = card
        self.device_area.addWidget(card)

        # Create and add a new video canvas for this device
        canvas = VideoCanvas()
        self._video_canvases[ip] = canvas
        self.video_layout.addWidget(canvas)

        self.status_dot.set_color(ACCENT_GREEN)
        self.status_label.setText(f"Active connections: {len(self._video_canvases)}")
        self.status_label.setStyleSheet(f"color: {ACCENT_GREEN}; font-size: 12px; font-weight: 600;")
        self._on_log("ok", f"Device connected: {ip}")

    def _on_device_disconnected(self, ip: str):
        if ip in self._device_cards:
            self._device_cards[ip].set_disconnected()
        
        # Remove and delete the video canvas for this device
        if ip in self._video_canvases:
            canvas = self._video_canvases.pop(ip)
            self.video_layout.removeWidget(canvas)
            canvas.deleteLater()

        # If no devices are left, show the main placeholder
        if not self._video_canvases:
            self._show_video_placeholder()
            self.status_dot.set_color(TEXT_DIM)
            self.status_label.setText("Waiting for connections…")
            self.status_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 12px;")
            self.lbl_fps.setText("")
            self.lbl_res.setText("")
            self.lbl_mbps.setText("")
        else:
            self.status_label.setText(f"Active connections: {len(self._video_canvases)}")
        
        self._on_log("warn", f"Device disconnected: {ip}")

    def _on_frame(self, ip: str, frame: np.ndarray):
        if ip in self._video_canvases:
            self._video_canvases[ip].update_frame(frame)

    def _on_stats(self, ip: str, stats: dict):
        if ip in self._device_cards:
            self._device_cards[ip].update_stats(stats)
        
        # Show stats for the first active device in the bottom bar
        if self._video_canvases and ip == list(self._video_canvases.keys())[0]:
            self.lbl_fps.setText(f"{stats.get('fps', 0):.1f} fps  ·")
            self.lbl_res.setText(f"  {stats.get('resolution', '--')}  ·")
            self.lbl_mbps.setText(f"  {stats.get('mbps', 0):.2f} Mbps")

    def _on_log(self, level: str, message: str):
        entry = LogEntry(level, message)
        # Insert before the stretch at the end
        count = self.log_layout.count()
        self.log_layout.insertWidget(count - 1, entry)
        # Keep max 50 log entries
        if count > 52:
            item = self.log_layout.itemAt(0)
            if item and item.widget():
                item.widget().deleteLater()
                self.log_layout.removeItem(item)
        # Scroll to bottom
        QTimer.singleShot(50, lambda: self.log_scroll.verticalScrollBar().setValue(
            self.log_scroll.verticalScrollBar().maximum()
        ))

    # ── Actions ────────────────────────────────────────────────────────────

    def _open_dashboard(self):
        import webbrowser
        webbrowser.open("http://localhost:8080")
        self._on_log("info", "Opened Web Dashboard UI on http://localhost:8080")

    def _take_screenshot(self):
        frame = None
        if self._video_canvases:
            first_ip = list(self._video_canvases.keys())[0]
            frame = self._video_canvases[first_ip].get_current_frame()
            
        if frame is None:
            self._on_log("warn", "No active stream to screenshot")
            return
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Screenshot",
            f"{ts}_mirror.png",
            "Images (*.png *.jpg)"
        )
        if path:
            cv2.imwrite(path, frame)
            self._on_log("ok", f"Screenshot saved: {path}")

    def _toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
            self.btn_fullscreen.setText("⛶  Fullscreen")
        else:
            self.showFullScreen()
            self.btn_fullscreen.setText("⊡  Exit Fullscreen")

    def closeEvent(self, event):
        if hasattr(self, 'backend_process') and self.backend_process:
            self.backend_process.terminate()
        for w in self._stream_workers.values():
            w.stop()
        self.server.stop()
        self.discovery.stop()
        try:
            self.beacon.stop()
        except:
            pass
        event.accept()


# ═══════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════

def main():
    app = QApplication(sys.argv)
    
    # Check for custom title argument
    title = "Mirror Server"
    if "--title" in sys.argv:
        try:
            idx = sys.argv.index("--title")
            title = sys.argv[idx + 1]
        except (ValueError, IndexError):
            pass
            
    app.setApplicationName(title)
    app.setApplicationVersion("2.0")

    # macOS native dark mode integration
    app.setStyle("Fusion")
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(BG_DARK))
    palette.setColor(QPalette.WindowText, QColor(TEXT_PRIMARY))
    palette.setColor(QPalette.Base, QColor(BG_CARD))
    palette.setColor(QPalette.AlternateBase, QColor(BG_SIDEBAR))
    palette.setColor(QPalette.Text, QColor(TEXT_PRIMARY))
    palette.setColor(QPalette.Button, QColor(BG_CARD))
    palette.setColor(QPalette.ButtonText, QColor(TEXT_PRIMARY))
    palette.setColor(QPalette.Highlight, QColor(ACCENT_BLUE))
    palette.setColor(QPalette.HighlightedText, QColor("#FFFFFF"))
    app.setPalette(palette)

    window = MirrorWindow(title=title)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
